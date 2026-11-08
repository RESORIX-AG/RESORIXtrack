/**
 * Time entries: list, manual create, correct, soft delete, restore, dispute, history (port of v1
 * services/entries.py). The clock state machine lives in clock.ts.
 *
 * Rules: entries never overlap, last at most 24 h, never lie in the future; changes by someone else (lead, HR)
 * and, when the setting is on, own changes to past days need a reason; signed-off months are read-only;
 * every write is a revision; the owner is notified (and mailed) about corrections and may dispute them.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or } from "drizzle-orm"
import { db } from "../db"
import { revisions, type TimeEntry, timeEntries, type User, users } from "../db/schema"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import {
  fmtInstant,
  instantOfMs,
  iso,
  localDateOf,
  localToday,
  nowInstant,
  rangeBoundsUtc,
  utcnow,
  zone,
} from "../time"
import { ensureOpenInstants } from "./locks"
import { notify } from "./notifications"
import { deferMail } from "./outbox"
import {
  type Actor,
  beforeCover,
  canManageUser,
  canViewUser,
  clampFrom,
  getUserOr404,
  requireDate,
  requireView,
  seesDate,
} from "./permissions"
import { type EntryProject, entryProjects, type ProjectFields, resolveProjectFields } from "./project-time"
import { record, revisionVisible, serializeRevision, snapshot } from "./revisions"
import { getSetting } from "./settings"

export const MAX_ENTRY_MS = 24 * 3600_000
export const FUTURE_TOLERANCE_MS = 2 * 60_000
export type EntrySource = TimeEntry["source"]
export type RevisionSource = EntrySource | "web"

// ------------------------------------------------------------------ instants

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * Parse an instant from the client: ISO with `Z`/offset, or a local wall-clock time (`YYYY-MM-DDTHH:MM[:SS]`)
 * interpreted in `tz` (the entry owner's timezone).
 */
export function parseInstantInput(value: string, tz: string, field = "at"): string {
  try {
    if (OFFSET_RE.test(value)) return fmtInstant(Temporal.Instant.from(value))
    return fmtInstant(Temporal.PlainDateTime.from(value).toZonedDateTime(zone(tz)).toInstant())
  } catch {
    throw new Validation("Invalid time", { fields: { [field]: "invalid" } })
  }
}

export const ms = (at: string): number => Date.parse(at)

// ------------------------------------------------------------------ serialization

export type EntryView = {
  id: number
  userId: number
  /** "break" only on legacy rows (pauses were removed; a break is a clock-out). */
  kind: "work" | "break"
  startAt: string
  endAt: string | null
  running: boolean
  /** "Clock out later": when the running entry closes automatically (ISO). */
  scheduledEndAt: string | null
  tz: string
  note: string
  projectId: number | null
  project: EntryProject | null
  source: EntrySource
  minutes: number
  createdById: number | null
  edited: boolean
  corrected: boolean
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export function serializeEntry(
  e: TimeEntry,
  flags: { edited?: boolean; corrected?: boolean; projects?: Map<number, EntryProject> } = {},
): EntryView {
  const end = e.endAt ? ms(e.endAt) : nowInstant().epochMilliseconds
  const projects = flags.projects ?? entryProjects([e.projectId])
  return {
    id: e.id,
    userId: e.userId,
    kind: e.kind,
    startAt: iso(e.startAt),
    endAt: iso(e.endAt),
    running: e.endAt == null,
    scheduledEndAt: e.endAt == null ? iso(e.scheduledEndAt) : null,
    tz: e.tz,
    note: e.note,
    projectId: e.projectId,
    project: e.projectId != null ? (projects.get(e.projectId) ?? null) : null,
    source: e.source,
    minutes: Math.round(Math.max(0, (end - ms(e.startAt)) / 60000) * 100) / 100,
    createdById: e.createdById,
    edited: flags.edited ?? false,
    corrected: flags.corrected ?? (e.createdById != null && e.createdById !== e.userId),
    deleted: e.isDeleted,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  }
}

/** Entries that have revisions beyond their creation. */
export function editedEntryIds(ids: number[]): Set<number> {
  if (!ids.length) return new Set()
  const rows = db
    .selectDistinct({ id: revisions.entityId })
    .from(revisions)
    .where(
      and(
        eq(revisions.entity, "time_entry"),
        inArray(revisions.entityId, ids),
        inArray(revisions.action, ["update", "delete", "restore"]),
      ),
    )
    .all()
  return new Set(rows.map((r) => r.id))
}

/** Entries someone other than the owner created or changed. */
export function correctedEntryIds(ids: number[], ownerId: number): Set<number> {
  if (!ids.length) return new Set()
  const rows = db
    .selectDistinct({ id: revisions.entityId })
    .from(revisions)
    .where(and(eq(revisions.entity, "time_entry"), inArray(revisions.entityId, ids), ne(revisions.actorId, ownerId)))
    .all()
  return new Set(rows.map((r) => r.id))
}

export function serializeEntries(rows: TimeEntry[], ownerId: number): EntryView[] {
  const ids = rows.map((e) => e.id)
  const edited = editedEntryIds(ids)
  const corrected = correctedEntryIds(ids, ownerId)
  const projects = entryProjects(rows.map((e) => e.projectId))
  return rows.map((e) => serializeEntry(e, { edited: edited.has(e.id), corrected: corrected.has(e.id), projects }))
}

// ------------------------------------------------------------------ reads

/** Entries overlapping [startUtc, endUtc) (instants), oldest first. */
export function entriesBetween(userId: number, startUtc: string, endUtc: string, includeDeleted = false): TimeEntry[] {
  const lowest = instantOfMs(ms(startUtc) - MAX_ENTRY_MS)
  const conds = [
    eq(timeEntries.userId, userId),
    lt(timeEntries.startAt, endUtc),
    or(
      and(gte(timeEntries.startAt, lowest), or(isNull(timeEntries.endAt), gt(timeEntries.endAt, startUtc))),
      isNull(timeEntries.endAt),
    ),
  ]
  if (!includeDeleted) conds.push(eq(timeEntries.isDeleted, false))
  return db
    .select()
    .from(timeEntries)
    .where(and(...conds))
    .orderBy(asc(timeEntries.startAt), asc(timeEntries.id))
    .all()
}

/** Entries of a person in the local date range [from, to]; deleted ones on request (history view). */
export function listEntries(
  actor: Actor,
  userId: number,
  from: string,
  to: string,
  includeDeleted = false,
): EntryView[] {
  const owner = requireView(actor, userId)
  const [s, e] = rangeBoundsUtc(clampFrom(actor, owner, from), to, owner.timezone)
  return serializeEntries(entriesBetween(owner.id, s, e, includeDeleted), owner.id)
}

function loadEntry(id: number): TimeEntry {
  const e = db.select().from(timeEntries).where(eq(timeEntries.id, id)).get()
  if (!e) throw new NotFound("Entry not found")
  return e
}

/** Entry and owner if the actor may see them; NotFound otherwise. */
export function visibleEntry(actor: Actor, id: number): { entry: TimeEntry; owner: User } {
  const entry = loadEntry(id)
  const owner = getUserOr404(entry.userId)
  if (!canViewUser(actor, owner)) throw new NotFound("Entry not found")
  requireDate(actor, owner, localDateOf(entry.startAt, owner.timezone), "Entry")
  return { entry, owner }
}

export function getEntry(actor: Actor, id: number): EntryView {
  const { entry, owner } = visibleEntry(actor, id)
  return serializeEntries([entry], owner.id)[0]
}

export function entryHistory(actor: Actor, id: number) {
  const { entry, owner } = visibleEntry(actor, id)
  const rows = db
    .select({ rev: revisions, name: users.name })
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.actorId))
    .where(and(eq(revisions.entity, "time_entry"), eq(revisions.entityId, entry.id)))
    .orderBy(asc(revisions.at), asc(revisions.id))
    .all()
  return rows.filter((r) => revisionVisible(actor, owner, r.rev)).map((r) => serializeRevision(r.rev, r.name))
}

/** Recent changes affecting a person (entries, absences, adjustments, schedules, work log). */
export function userHistory(actor: Actor, userId: number, limit = 200) {
  const owner = requireView(actor, userId)
  const rows = db
    .select({ rev: revisions, name: users.name })
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.actorId))
    .where(eq(revisions.subjectUserId, owner.id))
    .orderBy(desc(revisions.at), desc(revisions.id))
    .limit(Math.min(Math.max(limit, 1), 1000))
    .all()
  return rows.filter((r) => revisionVisible(actor, owner, r.rev)).map((r) => serializeRevision(r.rev, r.name))
}

// ------------------------------------------------------------------ guards

function authorize(actor: Actor, owner: User): void {
  if (actor.id !== owner.id && !canManageUser(actor, owner)) {
    throw new Forbidden("You can only change your own entries or those of teams you lead")
  }
}

/** A lead covering from a given day changes nothing before it. */
function ensureInCover(actor: Actor, owner: User, ...instants: (string | null)[]): void {
  for (const at of instants)
    if (at && !seesDate(actor, owner, localDateOf(at, owner.timezone))) throw beforeCover(actor, owner)
}

export function checkOverlap(userId: number, start: string, end: string | null, excludeId?: number): void {
  const far = end ?? instantOfMs(nowInstant().epochMilliseconds + 3650 * 86_400_000)
  const lowest = instantOfMs(ms(start) - MAX_ENTRY_MS)
  const conds = [
    eq(timeEntries.userId, userId),
    eq(timeEntries.isDeleted, false),
    lt(timeEntries.startAt, far),
    or(
      and(gte(timeEntries.startAt, lowest), or(isNull(timeEntries.endAt), gt(timeEntries.endAt, start))),
      isNull(timeEntries.endAt),
    ),
  ]
  if (excludeId != null) conds.push(ne(timeEntries.id, excludeId))
  const other = db
    .select()
    .from(timeEntries)
    .where(and(...conds))
    .limit(1)
    .get()
  if (other) {
    throw new Conflict("This time overlaps another entry", {
      code: "overlap",
      fields: { overlaps: serializeEntry(other) },
    })
  }
}

function validateInterval(start: string, end: string | null): void {
  const now = nowInstant().epochMilliseconds
  if (ms(start) > now + FUTURE_TOLERANCE_MS)
    throw new Validation("Start time is in the future", { fields: { startAt: "future" } })
  if (end == null) return
  if (ms(end) <= ms(start)) throw new Validation("End must be after start", { fields: { endAt: "before_start" } })
  if (ms(end) > now + FUTURE_TOLERANCE_MS)
    throw new Validation("End time is in the future", { fields: { endAt: "future" } })
  if (ms(end) - ms(start) > MAX_ENTRY_MS) {
    throw new Validation("An entry cannot be longer than 24 hours", { fields: { endAt: "too_long" } })
  }
}

/** Corrections by others always need a reason; own changes to past days when the company setting says so. */
export function reasonRequired(actor: Actor, owner: User, ...instants: (string | null | undefined)[]): boolean {
  if (actor.id !== owner.id) return true
  if (!getSetting("reason_required_for_past_edits")) return false
  const today = localToday(owner.timezone)
  return instants.some((at) => at != null && localDateOf(at, owner.timezone) < today)
}

function requireReason(actor: Actor, owner: User, reason: string, ...instants: (string | null | undefined)[]): void {
  if (reasonRequired(actor, owner, ...instants) && !reason.trim()) {
    throw new Validation("Please give a reason for this change", { fields: { reason: "required" } })
  }
}

function localWall(at: string | null, tz: string): string | null {
  if (!at) return null
  return Temporal.Instant.from(at)
    .toZonedDateTimeISO(zone(tz))
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" })
    .replace("T", " ")
}

function notifyCorrection(actor: Actor, owner: User, entry: TimeEntry, action: string, reason: string): void {
  if (actor.id === owner.id) return
  notify(owner.id, "entry_corrected", {
    entry_id: entry.id,
    action,
    actor_id: actor.id,
    actor_name: actor.user.name,
    reason,
    start_at: iso(entry.startAt),
    end_at: iso(entry.endAt),
  })
  if (owner.notifyEmailOnCorrection && owner.isActive) {
    deferMail({ email: owner.email, name: owner.name, locale: owner.locale }, "entry_corrected", {
      name: owner.name,
      actor_name: actor.user.name,
      action,
      reason,
      kind: entry.kind,
      local_start: localWall(entry.startAt, owner.timezone),
      local_end: localWall(entry.endAt, owner.timezone),
      timezone: owner.timezone,
    })
  }
}

// ------------------------------------------------------------------ writes

export interface EntryInput extends ProjectFields {
  userId?: number | null
  startAt: string
  endAt: string
  note?: string
  reason?: string
  source?: EntrySource
}

function targetFor(actor: Actor, userId: number | null | undefined): User {
  if (userId == null || userId === actor.id) return actor.user
  return requireView(actor, userId)
}

/** Manual entry (forgot to clock in) or a correction by a lead/HR for a member (reason required then). */
export function createEntry(actor: Actor, input: EntryInput): EntryView {
  const owner = targetFor(actor, input.userId)
  authorize(actor, owner)
  const start = parseInstantInput(input.startAt, owner.timezone, "startAt")
  if (!input.endAt) throw new Validation("End time is required", { fields: { endAt: "required" } })
  const end = parseInstantInput(input.endAt, owner.timezone, "endAt")
  validateInterval(start, end)
  ensureInCover(actor, owner, start)
  const reason = input.reason ?? ""
  requireReason(actor, owner, reason, start)
  ensureOpenInstants(owner, start, end)
  checkOverlap(owner.id, start, end)
  const project = resolveProjectFields(actor, owner, input, null)
  const source = input.source ?? "manual"
  const now = utcnow()
  const e = db
    .insert(timeEntries)
    .values({
      userId: owner.id,
      kind: "work",
      startAt: start,
      endAt: end,
      tz: owner.timezone,
      note: (input.note ?? "").trim().slice(0, 500),
      ...project,
      source,
      createdById: actor.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: e,
    action: "create",
    actor,
    subjectUserId: owner.id,
    before: null,
    reason,
    source,
  })
  notifyCorrection(actor, owner, e, "create", reason)
  return serializeEntries([e], owner.id)[0]
}

export interface EntryChanges extends ProjectFields {
  startAt?: string
  /** `null` keeps a running entry open; a finished entry cannot be reopened. */
  endAt?: string | null
  note?: string
}

export function updateEntry(
  actor: Actor,
  id: number,
  changes: EntryChanges,
  reason = "",
  source: RevisionSource = "web",
): EntryView {
  const { entry, owner } = visibleEntry(actor, id)
  authorize(actor, owner)
  if (entry.isDeleted) throw new Conflict("Entry was deleted", { code: "deleted" })
  const start = changes.startAt != null ? parseInstantInput(changes.startAt, owner.timezone, "startAt") : entry.startAt
  let end = entry.endAt
  if (changes.endAt !== undefined)
    end = changes.endAt == null ? null : parseInstantInput(changes.endAt, owner.timezone, "endAt")
  if (entry.endAt != null && end == null) {
    throw new Validation("A finished entry cannot be reopened", { fields: { endAt: "required" } })
  }
  ensureInCover(actor, owner, start)
  const timesChanged =
    ms(start) !== ms(entry.startAt) || (end ? ms(end) : null) !== (entry.endAt ? ms(entry.endAt) : null)
  if (timesChanged) validateInterval(start, end)
  requireReason(actor, owner, reason, entry.startAt, start)
  ensureOpenInstants(owner, entry.startAt, entry.endAt, start, end)
  if (timesChanged) checkOverlap(owner.id, start, end, entry.id)
  const next = {
    ...entry,
    startAt: timesChanged ? start : entry.startAt,
    endAt: timesChanged ? end : entry.endAt,
    ...resolveProjectFields(actor, owner, changes, entry),
  }
  if (changes.note !== undefined) next.note = (changes.note ?? "").trim().slice(0, 500)
  const before = snapshot("time_entry", entry)
  if (JSON.stringify(snapshot("time_entry", next)) === JSON.stringify(before))
    return serializeEntries([entry], owner.id)[0]
  const updated = db
    .update(timeEntries)
    .set({
      startAt: next.startAt,
      endAt: next.endAt,
      note: next.note,
      projectId: next.projectId,
      updatedAt: utcnow(),
    })
    .where(eq(timeEntries.id, entry.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: updated,
    action: "update",
    actor,
    subjectUserId: owner.id,
    before,
    reason,
    source,
  })
  notifyCorrection(actor, owner, updated, "update", reason)
  return serializeEntries([updated], owner.id)[0]
}

/** Soft delete: the entry stays in the history. A running entry is closed now. */
export function deleteEntry(actor: Actor, id: number, reason = "", source: RevisionSource = "web"): void {
  const { entry, owner } = visibleEntry(actor, id)
  authorize(actor, owner)
  if (entry.isDeleted) return
  // deleting always needs a reason, own entries of today included: the history must say why time disappeared
  if (!reason.trim())
    throw new Validation("Please give a reason for deleting this entry", { fields: { reason: "required" } })
  ensureOpenInstants(owner, entry.startAt, entry.endAt)
  const before = snapshot("time_entry", entry)
  const endAt = entry.endAt ?? instantOfMs(Math.max(nowInstant().epochMilliseconds, ms(entry.startAt) + 1000))
  const updated = db
    .update(timeEntries)
    .set({ isDeleted: true, endAt, updatedAt: utcnow() })
    .where(eq(timeEntries.id, entry.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: updated,
    action: "delete",
    actor,
    subjectUserId: owner.id,
    before,
    reason,
    source,
  })
  notifyCorrection(actor, owner, updated, "delete", reason)
}

/** Undo a soft delete (fails if the time is taken by another entry meanwhile). */
export function restoreEntry(actor: Actor, id: number, reason = "", source: RevisionSource = "web"): EntryView {
  const { entry, owner } = visibleEntry(actor, id)
  authorize(actor, owner)
  if (!entry.isDeleted) return serializeEntries([entry], owner.id)[0]
  requireReason(actor, owner, reason, entry.startAt)
  ensureOpenInstants(owner, entry.startAt, entry.endAt)
  checkOverlap(owner.id, entry.startAt, entry.endAt, entry.id)
  const before = snapshot("time_entry", entry)
  const updated = db
    .update(timeEntries)
    .set({ isDeleted: false, updatedAt: utcnow() })
    .where(eq(timeEntries.id, entry.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: updated,
    action: "restore",
    actor,
    subjectUserId: owner.id,
    before,
    reason,
    source,
  })
  notifyCorrection(actor, owner, updated, "restore", reason)
  return serializeEntries([updated], owner.id)[0]
}

/** The owner disagrees with a correction: notify (and mail) whoever changed the entry last. */
export function disputeEntry(actor: Actor, id: number, message: string): void {
  const { entry } = visibleEntry(actor, id)
  if (actor.id !== entry.userId) throw new Forbidden("Only the owner can dispute a correction")
  const text = message.trim().slice(0, 500)
  if (!text) throw new Validation("Please describe what is wrong", { fields: { message: "required" } })
  const last = db
    .select({ actorId: revisions.actorId })
    .from(revisions)
    .where(
      and(
        eq(revisions.entity, "time_entry"),
        eq(revisions.entityId, entry.id),
        ne(revisions.actorId, actor.id),
        ne(revisions.action, "dispute"),
      ),
    )
    .orderBy(desc(revisions.at), desc(revisions.id))
    .limit(1)
    .get()
  if (last?.actorId == null)
    throw new Conflict("This entry was not changed by someone else", { code: "nothing_to_dispute" })
  const target = getUserOr404(last.actorId)
  record({
    entity: "time_entry",
    row: entry,
    action: "dispute",
    actor,
    subjectUserId: actor.id,
    before: snapshot("time_entry", entry),
    reason: text,
  })
  notify(target.id, "entry_disputed", {
    entry_id: entry.id,
    user_id: actor.id,
    actor_id: actor.id,
    actor_name: actor.user.name,
    message: text,
    start_at: iso(entry.startAt),
  })
  if (target.isActive) {
    deferMail({ email: target.email, name: target.name, locale: target.locale }, "entry_disputed", {
      name: target.name,
      actor_name: actor.user.name,
      message: text,
      local_start: localWall(entry.startAt, actor.user.timezone),
      timezone: actor.user.timezone,
    })
  }
}
