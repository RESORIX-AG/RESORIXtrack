/**
 * Team overview for leads, deputies and HR: who is in today, who is away this week, month figures, balances
 * and vacation left per member; and the data of one member for the member page.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import type { z } from "zod"
import { db } from "../db"
import { teams, timeEntries, type User } from "../db/schema"
import { Forbidden } from "../errors"
import { addDays, iso, localToday, monthBounds, weekStart } from "../time"
import { absenceTypesById, serializeAbsenceType } from "./absence-types"
import { absencesInRange, clippedDays, minDay, serializeAbsences } from "./absences"
import { computeDays, personAccounts, summarize, timeBalance, vacationAccount } from "./accounts"
import { countFindings, periodFindings, teamComplianceSummary } from "./compliance"
import {
  type Actor,
  canAdjustBalance,
  canEditSchedule,
  canManageUser,
  isManager,
  requireView,
  seesDate,
} from "./permissions"
import { scheduleOn, schedulesOf } from "./schedules"
import { settingsTimeline } from "./settings"
import { monthStatus, parseMonth, scopeUsers } from "./signoffs"

export { overviewInput } from "./team.schemas"

import { overviewInput } from "./team.schemas"

export type PresenceState = "working" | "off"

/** Running entries of these people: one query. */
function presence(userIds: number[]): Map<number, { state: PresenceState; since: string }> {
  if (!userIds.length) return new Map()
  const rows = db
    .select({ userId: timeEntries.userId, startAt: timeEntries.startAt })
    .from(timeEntries)
    .where(and(inArray(timeEntries.userId, userIds), isNull(timeEntries.endAt), eq(timeEntries.isDeleted, false)))
    .all()
  return new Map(rows.map((r) => [r.userId, { state: "working" as const, since: iso(r.startAt) }]))
}

function teamNames(people: User[]): Map<number, string> {
  const ids = [...new Set(people.map((u) => u.teamId).filter((x): x is number => x != null))]
  if (!ids.length) return new Map()
  return new Map(
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, ids))
      .all()
      .map((t) => [t.id, t.name]),
  )
}

export function teamOverview(actor: Actor, raw: z.input<typeof overviewInput> = {}) {
  if (!isManager(actor)) throw new Forbidden("Only team leads and HR see the team overview")
  const input = overviewInput.parse(raw)
  const today = localToday(actor.user.timezone)
  const month = input.month ?? today.slice(0, 7)
  const [y, m] = parseMonth(month)
  const [mStart, mEnd] = monthBounds(y, m)
  const people = scopeUsers(actor, { teamId: input.teamId, periodStart: mStart })
  const ids = people.map((u) => u.id)
  const wStart = weekStart(today)
  const wEnd = addDays(wStart, 6)
  const types = absenceTypesById()
  const byId = new Map(people.map((u) => [u.id, u]))
  const week = absencesInRange(ids, wStart, wEnd, ["approved", "pending"]).filter((a) =>
    seesDate(actor, byId.get(a.userId)!, a.endDate),
  )
  const running = presence(ids)
  const signed = monthStatus(ids, month)
  const names = teamNames(people)
  const lastDay = minDay(mEnd, today)
  const settings = settingsTimeline()
  const findings = new Map(
    mStart <= lastDay
      ? teamComplianceSummary(actor, mStart, lastDay, input.teamId).map((r) => [r.userId, r.counts])
      : [],
  )
  // the team summary leaves out the viewer; a lead in their own team still sees their own row's findings
  const self = people.find((u) => u.id === actor.id)
  if (self && mStart <= lastDay && !findings.has(self.id))
    findings.set(self.id, countFindings(periodFindings(self, mStart, lastDay, undefined, { settings })))

  const members = people.map((u) => {
    const mine = week.filter((a) => a.userId === u.id)
    const brief = (a: (typeof week)[number]) => {
      const t = types.get(a.typeId)!
      return {
        id: a.id,
        type: serializeAbsenceType(t),
        status: a.status,
        startDate: a.startDate,
        endDate: a.endDate,
        startHalf: a.startHalf,
        endHalf: a.endHalf,
        daysThisWeek: clippedDays(u, a, wStart, wEnd),
      }
    }
    const acc = personAccounts(u, mStart, mEnd, y, { settings })
    const vac = acc.vacation
    return {
      user: {
        id: u.id,
        name: u.name,
        teamId: u.teamId,
        teamName: u.teamId != null ? (names.get(u.teamId) ?? null) : null,
        isActive: u.isActive,
      },
      presence: running.get(u.id) ?? { state: "off" as PresenceState, since: null },
      absentToday: mine.filter((a) => a.startDate <= today && a.endDate >= today).map(brief),
      absencesThisWeek: mine.map(brief),
      month: summarize(acc.days),
      balanceMin: acc.balance.balanceMin,
      vacation: { remaining: vac.remaining, pending: vac.pending, planned: vac.planned, taken: vac.taken },
      signedOff: signed.has(u.id),
      findings: findings.get(u.id) ?? null,
    }
  })
  return {
    month,
    today,
    week: { start: wStart, end: wEnd },
    members,
    totals: {
      people: members.length,
      working: members.filter((x) => x.presence.state !== "off").length,
      absentToday: members.filter((x) => x.absentToday.some((a) => a.status === "approved")).length,
    },
  }
}
export type TeamOverview = ReturnType<typeof teamOverview>

/** Everything the member page needs about one person (leads of their team and HR). */
export function memberDetail(actor: Actor, userId: number) {
  const u = requireView(actor, userId)
  if (u.id !== actor.id && !isManager(actor)) throw new Forbidden("Only team leads and HR see member pages")
  const today = localToday(u.timezone)
  const year = Number(today.slice(0, 4))
  const [mStart, mEnd] = monthBounds(year, Number(today.slice(5, 7)))
  const schedule = scheduleOn(schedulesOf(u.id), today)
  const vac = vacationAccount(u, year)
  const team =
    u.teamId != null
      ? db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, u.teamId)).get()
      : null
  const recentFrom = addDays(today, -13)
  const recent = computeDays(u, recentFrom, today).filter((d) => seesDate(actor, u, d.date))
  const upcoming = absencesInRange([u.id], today, addDays(today, 180), ["approved", "pending"]).filter((a) =>
    seesDate(actor, u, a.endDate),
  )
  const lastEntry = db
    .select({ startAt: timeEntries.startAt })
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, u.id), eq(timeEntries.isDeleted, false)))
    .orderBy(desc(timeEntries.startAt))
    .limit(1)
    .get()
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      team,
      timezone: u.timezone,
      employmentStart: u.employmentStart,
      employmentEnd: u.employmentEnd,
      isActive: u.isActive,
      recordingMode: u.recordingMode,
      pensumPercent: schedule?.pensumPercent ?? null,
    },
    presence: presence([u.id]).get(u.id) ?? { state: "off" as PresenceState, since: null },
    lastActivity: iso(lastEntry?.startAt ?? null),
    balance: timeBalance(u),
    month: summarize(computeDays(u, mStart, mEnd)),
    vacation: {
      year,
      entitlement: vac.entitlement,
      carriedOver: vac.carriedOver,
      taken: vac.taken,
      planned: vac.planned,
      pending: vac.pending,
      remaining: vac.remaining,
    },
    recentDays: recent.map((d) => ({
      date: d.date,
      workedMin: d.workedMin,
      targetMin: d.targetMin,
      deltaMin: d.deltaMin,
      running: d.running,
      absences: d.absences.map((a) => ({
        typeKey: a.typeKey,
        label: a.label,
        color: a.color,
        status: a.status,
        halves: a.halves,
      })),
      holiday: d.holiday,
      warnings: d.warnings,
    })),
    upcomingAbsences: serializeAbsences(actor, upcoming),
    permissions: {
      manage: canManageUser(actor, u),
      editSchedule: canEditSchedule(actor, u),
      adjustBalance: canAdjustBalance(actor, u),
    },
  }
}
export type MemberDetail = ReturnType<typeof memberDetail>
