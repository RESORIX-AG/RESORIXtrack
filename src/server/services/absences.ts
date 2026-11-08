/**
 * Absences (port of v1 services/absences.py): request -> approve/reject -> cancel, sick reports, records by
 * leads/HR, changes, history. Half days: a single day is full, am or pm; a multi-day absence starts full or
 * pm and ends full or am. Signed-off months are locked (services/locks.ts + database triggers).
 *
 * Decisions: the person's active leads/deputies, else HR, else (last resort) administrators, never the
 * person themselves (permissions.approversFor). In-app notifications are written in the transaction,
 * emails are deferred until it committed (services/outbox.ts).
 */
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm"
import type { z } from "zod"
import type { JsonObject } from "@/lib/json"
import { db } from "../db"
import {
  type Absence,
  type AbsenceStatus,
  type AbsenceType,
  absences,
  attachments,
  type HalfDay,
  type User,
  users,
} from "../db/schema"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import { addDays, daterange, iso, localToday, utcnow } from "../time"
import { absenceTypesById, getAbsenceType, isSensitive, serializeAbsenceType } from "./absence-types"
import { absenceHalves, computeDays, countAbsenceDays, vacationAccount } from "./accounts"
import { stopRunning } from "./clock"
import { ensureOpenDates } from "./locks"
import { notify } from "./notifications"
import { deferMail } from "./outbox"
import {
  type Actor,
  approversFor,
  beforeCover,
  canManageUser,
  canViewUser,
  getUserOr404,
  hrSelfFallback,
  requireView,
  seesDate,
  visibleUserIds,
} from "./permissions"
import { history, record, serializeRevision, snapshot } from "./revisions"
import { getSetting } from "./settings"

export const ACTIVE_STATES: AbsenceStatus[] = ["pending", "approved"]
export const isActiveState = (s: AbsenceStatus) => s === "pending" || s === "approved"

// ------------------------------------------------------------------ inputs

export {
  type AbsenceInput,
  type AbsencePatch,
  absenceInput,
  absencePatch,
  dayString,
  listInput,
  maxDay,
  minDay,
  previewInput,
} from "./absences.schemas"

import {
  type AbsenceInput,
  type AbsencePatch,
  absenceInput,
  absencePatch,
  listInput,
  maxDay,
  minDay,
  previewInput,
} from "./absences.schemas"

// ------------------------------------------------------------------ half days

type Span = Pick<Absence, "startDate" | "endDate" | "startHalf" | "endHalf">

const daysBetween = (a: string, b: string) => Temporal.PlainDate.from(a).until(b).days

export function validateHalves(start: string, end: string, startHalf: HalfDay, endHalf: HalfDay): void {
  if (end < start) throw new Validation("End date is before start date", { fields: { endDate: "before_start" } })
  if (daysBetween(start, end) > 366)
    throw new Validation("An absence cannot be longer than a year", { fields: { endDate: "too_long" } })
  if (start === end) return
  if (startHalf === "am")
    throw new Validation("A multi-day absence can only start in the afternoon", { fields: { startHalf: "invalid" } })
  if (endHalf === "pm")
    throw new Validation("A multi-day absence can only end at noon", { fields: { endHalf: "invalid" } })
}

function checkOverlap(owner: User, probe: Span, excludeId?: number): void {
  const conds = [
    eq(absences.userId, owner.id),
    inArray(absences.status, ACTIVE_STATES),
    lte(absences.startDate, probe.endDate),
    gte(absences.endDate, probe.startDate),
  ]
  if (excludeId != null) conds.push(ne(absences.id, excludeId))
  for (const other of db
    .select()
    .from(absences)
    .where(and(...conds))
    .all()) {
    const from = maxDay(other.startDate, probe.startDate)
    const to = minDay(other.endDate, probe.endDate)
    for (const d of daterange(from, to)) {
      const mine = new Set(absenceHalves(probe, d))
      if (absenceHalves(other, d).some((h) => mine.has(h))) {
        throw new Conflict(`Overlaps an existing absence (${other.startDate} to ${other.endDate})`, {
          code: "absence_overlap",
          fields: { overlaps: other.id },
        })
      }
    }
  }
}

// ------------------------------------------------------------------ lookups & permissions

export function getAbsence(id: number): Absence {
  const a = db.select().from(absences).where(eq(absences.id, id)).get()
  if (!a) throw new NotFound("Absence not found")
  return a
}

/** Decides `owner`'s requests: leads/HR who manage the person, or the last-resort approvers. Never oneself. */
export function canDecide(actor: Actor, owner: User): boolean {
  if (actor.id === owner.id) return false
  return canManageUser(actor, owner) || approversFor(owner).some((u) => u.id === actor.id)
}

function canSee(actor: Actor, a: Absence, owner: User): boolean {
  // a lead covering from a later day sees absences that reach into the cover only
  if (!seesDate(actor, owner, a.endDate)) return false
  return canViewUser(actor, owner) || (a.status === "pending" && canDecide(actor, owner))
}

/** A lead covering from a later day changes no absence that starts before it. */
function ensureInCover(actor: Actor, owner: User, ...starts: string[]): void {
  for (const d of starts) if (!seesDate(actor, owner, d)) throw beforeCover(actor, owner)
}

/** The absence if the actor may see it (else NotFound, so ids are not leaked). */
export function visibleAbsence(actor: Actor, id: number): { absence: Absence; owner: User } {
  const absence = db.select().from(absences).where(eq(absences.id, id)).get()
  const owner = absence ? getUserOr404(absence.userId) : null
  if (!absence || !owner || !canSee(actor, absence, owner)) throw new NotFound("Absence not found")
  return { absence, owner }
}

export function canCancel(actor: Actor, a: Absence, owner: User, type: AbsenceType): boolean {
  if (!isActiveState(a.status)) return false
  if (canManageUser(actor, owner)) return true
  if (actor.id !== owner.id) return false
  if (a.status === "pending") return true
  const today = localToday(owner.timezone)
  if (type.category === "sick" && a.requestedById === owner.id) {
    return a.startDate >= addDays(today, -getSetting("sick_self_report_backdate_days"))
  }
  return a.startDate > today
}

function canEdit(actor: Actor, a: Absence, owner: User, type: AbsenceType): boolean {
  if (!isActiveState(a.status)) return false
  if (canManageUser(actor, owner)) return true
  return actor.id === owner.id && (a.status === "pending" || (type.category === "sick" && a.requestedById === owner.id))
}

export function permissionsFor(actor: Actor, a: Absence, owner: User, type: AbsenceType) {
  return {
    cancel: canCancel(actor, a, owner, type),
    decide: a.status === "pending" && canDecide(actor, owner),
    edit: canEdit(actor, a, owner, type),
    attach: type.allowsAttachments && isActiveState(a.status) && (actor.id === owner.id || canManageUser(actor, owner)),
  }
}

// ------------------------------------------------------------------ sick check

export type SickCheckReason = "not_a_workday" | "public_holiday" | "on_vacation" | "already_sick"

/** Whether `user` may report sick for day `d` (default today). */
export function selfSickAllowed(user: User, d?: string | null): { allowed: boolean; reason: SickCheckReason | null } {
  const date = d ?? localToday(user.timezone)
  const [day] = computeDays(user, date, date)
  if (!day?.employed || day.scheduledMin <= 0) return { allowed: false, reason: "not_a_workday" }
  if (day.holiday && day.holiday.fraction >= 1) return { allowed: false, reason: "public_holiday" }
  const approved = day.absences.find((x) => x.status === "approved" && x.halves.length > 0)
  if (approved) return { allowed: false, reason: approved.category === "sick" ? "already_sick" : "on_vacation" }
  return { allowed: true, reason: null }
}

const SICK_MESSAGES: Record<SickCheckReason, string> = {
  not_a_workday: "This is not one of your working days",
  public_holiday: "This day is a public holiday",
  on_vacation: "You are on vacation on this day",
  already_sick: "You are already reported sick on this day",
}

function checkSelfSick(owner: User, start: string, end: string): void {
  const today = localToday(owner.timezone)
  const backdate = getSetting("sick_self_report_backdate_days")
  const maxDays = getSetting("sick_self_report_max_days")
  if (start > today) throw new Validation("You can't report sick in advance", { fields: { startDate: "future" } })
  if (start < addDays(today, -backdate)) {
    throw new Validation(`Sick reports can be backdated by at most ${backdate} days; ask your team lead`, {
      fields: { startDate: "too_old" },
    })
  }
  if (daysBetween(start, end) + 1 > maxDays)
    throw new Validation(`A sick report can cover at most ${maxDays} days`, { fields: { endDate: "too_long" } })
  const check = selfSickAllowed(owner, start)
  if (check.reason) throw new Conflict(SICK_MESSAGES[check.reason], { code: check.reason })
}

// ------------------------------------------------------------------ notifications

function payload(a: Absence, t: AbsenceType, extra: JsonObject = {}): JsonObject {
  return { absence_id: a.id, type: t.label, type_key: t.key, start_date: a.startDate, end_date: a.endDate, ...extra }
}

/** Mail variables; notes of health-related absences never leave the app. */
function mailVars(a: Absence, t: AbsenceType, extra: JsonObject = {}): JsonObject {
  return {
    ...payload(a, t),
    start_half: a.startHalf,
    end_half: a.endHalf,
    note: isSensitive(t.category) ? "" : a.note,
    ...extra,
  }
}

const recipient = (u: User) => ({ email: u.email, name: u.name, locale: u.locale })

// ------------------------------------------------------------------ create / update

export function createAbsence(actor: Actor, raw: AbsenceInput, source = "web"): Absence {
  const input = absenceInput.parse(raw)
  const owner = input.userId != null && input.userId !== actor.id ? requireView(actor, input.userId) : actor.user
  const t = getAbsenceType(input.type)
  const isSelf = actor.id === owner.id
  if (!isSelf && !canManageUser(actor, owner))
    throw new Forbidden("You can only record absences for members of teams you lead")
  ensureInCover(actor, owner, input.startDate)
  const soleHr = hrSelfFallback(actor, owner)
  if (isSelf && !t.employeeCanRequest && !soleHr)
    throw new Forbidden(`'${t.label}' can only be recorded by your team lead or HR`, { code: "type_not_requestable" })
  const start = input.startDate
  const end = input.endDate ?? start
  const startHalf = input.startHalf
  const endHalf = start === end ? "full" : input.endHalf
  validateHalves(start, end, startHalf, endHalf)
  if (t.category === "sick" && isSelf && !soleHr) checkSelfSick(owner, start, end)

  ensureOpenDates(owner, start, end)
  const span = { startDate: start, endDate: end, startHalf, endHalf }
  checkOverlap(owner, span)
  const days = countAbsenceDays(owner, start, end, startHalf, endHalf)
  if (days <= 0)
    throw new Validation("The selected period contains no working days", { fields: { endDate: "no_workdays" } })

  // nobody else could decide (the only HR person or administrator): recorded directly, as a lead would
  const needsApproval = t.requiresApproval && isSelf && approversFor(owner).length > 0
  const now = utcnow()
  const a = db
    .insert(absences)
    .values({
      userId: owner.id,
      typeId: t.id,
      ...span,
      note: input.note.trim().slice(0, 1000),
      requestedById: actor.id,
      status: needsApproval ? "pending" : "approved",
      decidedById: needsApproval ? null : actor.id,
      decidedAt: needsApproval ? null : now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  record({ entity: "absence", row: a, action: "create", actor, subjectUserId: owner.id, before: null, source })

  if (needsApproval || isSelf) {
    const kind = needsApproval ? "absence_requested" : "absence_reported"
    for (const approver of approversFor(owner)) {
      notify(approver.id, kind, payload(a, t, { user_id: owner.id, user_name: owner.name, days }))
      deferMail(
        recipient(approver),
        kind,
        mailVars(a, t, { recipient_name: approver.name, requester_name: owner.name, days }),
      )
    }
  } else {
    notify(owner.id, "absence_recorded", payload(a, t, { actor_name: actor.user.name }))
    deferMail(
      recipient(owner),
      "absence_recorded",
      mailVars(a, t, { recipient_name: owner.name, actor_name: actor.user.name, days }),
    )
  }
  return a
}

export function updateAbsence(actor: Actor, id: number, raw: AbsencePatch, source = "web"): Absence {
  const patch = absencePatch.parse(raw)
  const { absence: a, owner } = visibleAbsence(actor, id)
  ensureInCover(actor, owner, a.startDate, patch.startDate ?? a.startDate)
  const t = absenceTypesById().get(a.typeId)!
  const isSelf = actor.id === owner.id
  const manager = canManageUser(actor, owner)
  if (!isActiveState(a.status))
    throw new Conflict("Only pending or approved absences can be changed", { code: "invalid_state" })
  if (!manager) {
    if (!isSelf) throw new Forbidden("Not allowed")
    const ownSick = t.category === "sick" && a.requestedById === owner.id
    if (a.status !== "pending" && !ownSick)
      throw new Forbidden("Approved absences can only be changed by your team lead; cancel it instead")
  }
  const reason = patch.reason.trim()
  if (!isSelf && !reason)
    throw new Validation("Please give a reason for this change", { fields: { reason: "required" } })
  const before = snapshot("absence", a)
  const start = patch.startDate ?? a.startDate
  const end = patch.endDate ?? a.endDate
  const startHalf = patch.startHalf ?? a.startHalf
  const endHalf = start === end ? "full" : (patch.endHalf ?? a.endHalf)
  validateHalves(start, end, startHalf, endHalf)
  const ownSickEdit = isSelf && !manager && t.category === "sick" && a.status === "approved"
  if (ownSickEdit) {
    const maxDays = getSetting("sick_self_report_max_days")
    if (start !== a.startDate) throw new Forbidden("The start of a sick report can only be changed by your team lead")
    if (daysBetween(start, end) + 1 > maxDays)
      throw new Validation(`A sick report can cover at most ${maxDays} days`, { fields: { endDate: "too_long" } })
    // added days follow the same backdating limit as a new report
    const backdate = getSetting("sick_self_report_backdate_days")
    if (end > a.endDate && addDays(a.endDate, 1) < addDays(localToday(owner.timezone), -backdate))
      throw new Validation(`Sick reports can be backdated by at most ${backdate} days; ask your team lead`, {
        fields: { endDate: "too_old" },
      })
  }
  ensureOpenDates(owner, minDay(start, a.startDate), maxDay(end, a.endDate))
  const span = { startDate: start, endDate: end, startHalf, endHalf }
  checkOverlap(owner, span, a.id)
  const days = countAbsenceDays(owner, start, end, startHalf, endHalf)
  if (days <= 0)
    throw new Validation("The selected period contains no working days", { fields: { endDate: "no_workdays" } })
  const note = patch.note != null ? patch.note.trim().slice(0, 1000) : a.note
  if (JSON.stringify(snapshot("absence", { ...a, ...span, note })) === JSON.stringify(before)) return a

  const updated = db
    .update(absences)
    .set({ ...span, note, updatedAt: utcnow() })
    .where(eq(absences.id, a.id))
    .returning()
    .get()
  record({ entity: "absence", row: updated, action: "update", actor, subjectUserId: owner.id, before, reason, source })
  if (ownSickEdit) {
    for (const approver of approversFor(owner)) {
      notify(approver.id, "absence_reported", payload(updated, t, { user_id: owner.id, user_name: owner.name, days }))
      deferMail(
        recipient(approver),
        "absence_reported",
        mailVars(updated, t, { recipient_name: approver.name, requester_name: owner.name, days }),
      )
    }
  } else if (!isSelf) {
    notify(owner.id, "absence_changed", payload(updated, t, { actor_name: actor.user.name, reason }))
    deferMail(
      recipient(owner),
      "absence_changed",
      mailVars(updated, t, { recipient_name: owner.name, actor_name: actor.user.name, reason, days }),
    )
  }
  return updated
}

// ------------------------------------------------------------------ workflow

export function decideAbsence(actor: Actor, id: number, approve: boolean, note = "", source = "web"): Absence {
  // a request reaching into a deputy's cover is theirs to decide (visibleAbsence checks the end date)
  const { absence: a, owner } = visibleAbsence(actor, id)
  if (a.status !== "pending") throw new Conflict("This request has already been decided", { code: "invalid_state" })
  if (!canDecide(actor, owner)) {
    throw new Forbidden(
      actor.id === owner.id ? "You cannot decide your own request" : "Only the team lead or HR can decide this request",
    )
  }
  ensureOpenDates(owner, a.startDate, a.endDate)
  if (approve) checkOverlap(owner, a, a.id)
  const before = snapshot("absence", a)
  const decisionNote = note.trim().slice(0, 1000)
  const updated = db
    .update(absences)
    .set({
      status: approve ? "approved" : "rejected",
      decidedById: actor.id,
      decidedAt: utcnow(),
      decisionNote,
      updatedAt: utcnow(),
    })
    .where(eq(absences.id, a.id))
    .returning()
    .get()
  record({
    entity: "absence",
    row: updated,
    action: approve ? "approve" : "reject",
    actor,
    subjectUserId: owner.id,
    before,
    reason: decisionNote,
    source,
  })
  const t = absenceTypesById().get(a.typeId)!
  const kind = approve ? "absence_approved" : "absence_rejected"
  notify(owner.id, kind, payload(updated, t, { actor_name: actor.user.name, note: decisionNote }))
  const days = countAbsenceDays(owner, a.startDate, a.endDate, a.startHalf, a.endHalf)
  deferMail(
    recipient(owner),
    kind,
    mailVars(updated, t, {
      recipient_name: owner.name,
      actor_name: actor.user.name,
      decision_note: decisionNote,
      days,
    }),
  )
  return updated
}

export function cancelAbsence(actor: Actor, id: number, reason = "", source = "web"): Absence {
  const { absence: a, owner } = visibleAbsence(actor, id)
  ensureInCover(actor, owner, a.startDate)
  const t = absenceTypesById().get(a.typeId)!
  if (!isActiveState(a.status)) throw new Conflict("This absence is already closed", { code: "invalid_state" })
  if (!canCancel(actor, a, owner, t))
    throw new Forbidden("Approved absences that have already started can only be cancelled by your team lead")
  const why = reason.trim().slice(0, 1000)
  if (actor.id !== owner.id && !why)
    throw new Validation("Please give a reason for the cancellation", { fields: { reason: "required" } })
  ensureOpenDates(owner, a.startDate, a.endDate)
  const before = snapshot("absence", a)
  const updated = db
    .update(absences)
    .set({
      status: "cancelled",
      cancelledById: actor.id,
      cancelledAt: utcnow(),
      cancelReason: why,
      updatedAt: utcnow(),
    })
    .where(eq(absences.id, a.id))
    .returning()
    .get()
  record({
    entity: "absence",
    row: updated,
    action: "cancel",
    actor,
    subjectUserId: owner.id,
    before,
    reason: why,
    source,
  })
  if (actor.id === owner.id) {
    if (a.status === "approved" || t.requiresApproval) {
      for (const approver of approversFor(owner)) {
        notify(
          approver.id,
          "absence_cancelled_by_owner",
          payload(updated, t, { user_id: owner.id, user_name: owner.name }),
        )
      }
    }
  } else {
    notify(owner.id, "absence_cancelled_yours", payload(updated, t, { actor_name: actor.user.name, reason: why }))
    deferMail(
      recipient(owner),
      "absence_cancelled",
      mailVars(updated, t, { recipient_name: owner.name, actor_name: actor.user.name, reason: why }),
    )
  }
  return updated
}

/** One click "sick today" for the signed-in person; stops a running clock. */
export function reportSickToday(actor: Actor, note = "", source = "web"): Absence {
  const today = localToday(actor.user.timezone)
  const a = createAbsence(actor, { type: "sick", startDate: today, endDate: today, note }, source)
  stopRunning(actor.user, actor, "Reported sick")
  return a
}

// ------------------------------------------------------------------ queries

export function absencesInRange(
  userIds: number[] | null,
  from: string,
  to: string,
  statuses?: AbsenceStatus[] | null,
): Absence[] {
  const conds = [lte(absences.startDate, to), gte(absences.endDate, from)]
  if (userIds) conds.push(inArray(absences.userId, userIds))
  if (statuses?.length) conds.push(inArray(absences.status, statuses))
  return db
    .select()
    .from(absences)
    .where(and(...conds))
    .orderBy(asc(absences.startDate), asc(absences.id))
    .all()
}

export function listAbsences(actor: Actor, raw: z.input<typeof listInput>) {
  const input = listInput.parse(raw)
  const visible = visibleUserIds(actor)
  let ids = visible
  if (input.userId != null) {
    requireView(actor, input.userId)
    ids = [input.userId]
  } else if (input.teamId != null) {
    const members = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.teamId, input.teamId))
      .all()
      .map((r) => r.id)
    const visibleIds = visible && new Set(visible)
    ids = visibleIds ? members.filter((i) => visibleIds.has(i)) : members
  }
  if (ids && !ids.length) return []
  const rows = absencesInRange(ids, input.from, input.to, input.status)
  const owners = usersById(rows.map((a) => a.userId))
  return serializeAbsences(
    actor,
    rows.filter((a) => seesDate(actor, owners.get(a.userId)!, a.endDate)),
  )
}

export function getAbsenceDto(actor: Actor, id: number) {
  return serializeAbsences(actor, [visibleAbsence(actor, id).absence])[0]
}

export function absenceHistory(actor: Actor, id: number) {
  const { absence } = visibleAbsence(actor, id)
  const revs = history("absence", absence.id)
  const atts = db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.absenceId, absence.id))
    .all()
    .map((r) => r.id)
  const all = [...revs, ...atts.flatMap((attId) => history("attachment", attId))].sort((x, y) =>
    x.at < y.at ? -1 : x.at > y.at ? 1 : x.id - y.id,
  )
  const names = userNames(all.map((r) => r.actorId))
  return all.map((r) => serializeRevision(r, r.actorId ? names.get(r.actorId) : null))
}

export function absencePreview(actor: Actor, raw: z.input<typeof previewInput>) {
  const input = previewInput.parse(raw)
  const owner = input.userId != null && input.userId !== actor.id ? requireView(actor, input.userId) : actor.user
  const end = input.endDate ?? input.startDate
  if (end < input.startDate || daysBetween(input.startDate, end) > 366)
    throw new Validation("Invalid date range", { fields: { endDate: "invalid" } })
  const endHalf = end === input.startDate ? "full" : input.endHalf
  const days = countAbsenceDays(owner, input.startDate, end, input.startHalf, endHalf)
  const t = getAbsenceType(input.type)
  const year = input.startDate.slice(0, 4)
  const vac = vacationAccount(owner, Number(year), input.excludeId ?? undefined)
  // days after New Year come from the next year's entitlement
  const span = { startDate: input.startDate, endDate: end, startHalf: input.startHalf, endHalf }
  const thisYear = end.startsWith(year) ? days : clippedDays(owner, span, input.startDate, `${year}-12-31`)
  return {
    days,
    deductsVacation: t.deductsVacation,
    vacationRemaining: vac.remainingAfterPending,
    vacationAfter: vac.remainingAfterPending - (t.deductsVacation ? thisYear : 0),
  }
}

/**
 * Requests waiting for the actor: HR all (except own), leads their teams, administrators those only they can
 * decide. People who left stay in: their pending requests block the sign-off of their last months.
 */
export function pendingForApprover(actor: Actor): Absence[] {
  if (!actor.isHr && !actor.isAdmin && actor.ledTeamIds.size === 0) return []
  const rows = db
    .select({ a: absences })
    .from(absences)
    .innerJoin(users, eq(users.id, absences.userId))
    .where(and(eq(absences.status, "pending"), ne(users.id, actor.id)))
    .orderBy(asc(absences.startDate), asc(absences.id))
    .all()
    .map((r) => r.a)
  if (actor.isHr) return rows
  const owners = usersById(rows.map((a) => a.userId))
  const decides = new Map<number, boolean>()
  return rows.filter((a) => {
    const owner = owners.get(a.userId)
    if (!owner || !seesDate(actor, owner, a.endDate)) return false
    if (!decides.has(owner.id)) decides.set(owner.id, canDecide(actor, owner))
    return decides.get(owner.id)
  })
}

/** Working days of `a` that fall into [from, to] (halves at the cut edges are kept where they apply). */
export function clippedDays(owner: User, a: Span, from: string, to: string): number {
  const start = maxDay(a.startDate, from)
  const end = minDay(a.endDate, to)
  if (start > end) return 0
  let startHalf: HalfDay = start === a.startDate ? a.startHalf : "full"
  const endHalf: HalfDay = end === a.endDate ? a.endHalf : "full"
  if (start === end && start !== a.startDate) startHalf = end === a.endDate && a.endHalf === "am" ? "am" : "full"
  return countAbsenceDays(owner, start, end, startHalf, start === end ? "full" : endHalf)
}

export function recentAbsences(userId: number, limit = 20): Absence[] {
  return db
    .select()
    .from(absences)
    .where(eq(absences.userId, userId))
    .orderBy(desc(absences.startDate))
    .limit(limit)
    .all()
}

// ------------------------------------------------------------------ serialisation

export function usersById(ids: (number | null | undefined)[]): Map<number, User> {
  const unique = [...new Set(ids.filter((x): x is number => x != null))]
  if (!unique.length) return new Map()
  return new Map(
    db
      .select()
      .from(users)
      .where(inArray(users.id, unique))
      .all()
      .map((u) => [u.id, u]),
  )
}

export function userNames(ids: (number | null | undefined)[]): Map<number, string> {
  const unique = [...new Set(ids.filter((x): x is number => x != null))]
  if (!unique.length) return new Map()
  return new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, unique))
      .all()
      .map((u) => [u.id, u.name]),
  )
}

export function serializeAttachment(att: typeof attachments.$inferSelect) {
  return {
    id: att.id,
    filename: att.filename,
    contentType: att.contentType,
    size: att.size,
    uploadedById: att.uploadedById,
    createdAt: iso(att.createdAt),
    url: `/api/attachments/${att.id}`,
  }
}
export type AttachmentDto = ReturnType<typeof serializeAttachment>

/** Batch serialisation (one query per related table, no per-row lookups except the day count). */
export function serializeAbsences(actor: Actor | null, rows: Absence[]) {
  if (!rows.length) return []
  const types = absenceTypesById()
  const people = usersById(rows.flatMap((a) => [a.userId, a.requestedById, a.decidedById, a.cancelledById]))
  const atts = db
    .select()
    .from(attachments)
    .where(
      and(
        inArray(
          attachments.absenceId,
          rows.map((a) => a.id),
        ),
        eq(attachments.isDeleted, false),
      ),
    )
    .orderBy(asc(attachments.id))
    .all()
  const ref = (id: number | null) => {
    const u = id != null ? people.get(id) : null
    return u ? { id: u.id, name: u.name } : null
  }
  return rows.map((a) => {
    const owner = people.get(a.userId)!
    const t = types.get(a.typeId)!
    return {
      id: a.id,
      user: { id: owner.id, name: owner.name, teamId: owner.teamId },
      type: serializeAbsenceType(t),
      startDate: a.startDate,
      endDate: a.endDate,
      startHalf: a.startHalf,
      endHalf: a.endHalf,
      days: countAbsenceDays(owner, a.startDate, a.endDate, a.startHalf, a.endHalf),
      note: a.note,
      status: a.status,
      requestedBy: ref(a.requestedById),
      decidedBy: ref(a.decidedById),
      decidedAt: iso(a.decidedAt),
      decisionNote: a.decisionNote,
      cancelledBy: ref(a.cancelledById),
      cancelledAt: iso(a.cancelledAt),
      cancelReason: a.cancelReason,
      attachments: atts.filter((x) => x.absenceId === a.id).map(serializeAttachment),
      createdAt: iso(a.createdAt),
      permissions: actor ? permissionsFor(actor, a, owner, t) : null,
    }
  })
}
export type AbsenceDto = ReturnType<typeof serializeAbsences>[number]
