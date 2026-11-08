/**
 * Who is absent when (people x days). Employees see their own team, leads their teams, HR everyone.
 * Health-related absences (category sick) of others are shown as "absent" without type or id unless the
 * viewer is the person, one of their leads/deputies or HR (revDSG Art. 5 lit. c, OR 328b).
 */
import { and, asc, eq, inArray, or } from "drizzle-orm"
import type { z } from "zod"
import { db } from "../db"
import { teams, type User, users } from "../db/schema"
import { Validation } from "../errors"
import { isSensitive } from "./absence-types"
import { computeDays, type DayAbsence } from "./accounts"
import { type Actor, canViewUser, seesDate, visibleUserIds } from "./permissions"

export { calendarInput } from "./team-calendar.schemas"

import { calendarInput } from "./team-calendar.schemas"

export const ABSENT_COLOR = "#8a8d93"

export interface CalendarAbsence {
  id: number | null
  typeKey: string
  label: string
  color: string
  category: DayAbsence["category"]
  status: DayAbsence["status"]
  halves: DayAbsence["halves"]
}

export function publicAbsence(x: DayAbsence, full: boolean): CalendarAbsence {
  if (!full && isSensitive(x.category)) {
    return {
      id: null,
      typeKey: "absent",
      label: "Absent",
      color: ABSENT_COLOR,
      category: "other",
      status: x.status,
      halves: x.halves,
    }
  }
  return {
    id: x.id,
    typeKey: x.typeKey,
    label: x.label,
    color: x.color,
    category: x.category,
    status: x.status,
    halves: x.halves,
  }
}

/** People the actor sees in calendars: visible people plus everyone in the actor's own and led teams. */
export function calendarPeople(actor: Actor, teamId?: number | null): User[] {
  const visible = visibleUserIds(actor)
  const conds = [eq(users.isActive, true)]
  if (visible) {
    const teamIds = [...actor.ledTeamIds, ...(actor.user.teamId != null ? [actor.user.teamId] : [])]
    conds.push(
      teamIds.length ? or(inArray(users.id, visible), inArray(users.teamId, teamIds))! : inArray(users.id, visible),
    )
  }
  if (teamId != null) conds.push(eq(users.teamId, teamId))
  return db
    .select()
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.name), asc(users.id))
    .all()
}

export function teamCalendar(actor: Actor, raw: z.input<typeof calendarInput>) {
  const input = calendarInput.parse(raw)
  if (input.to < input.from) throw new Validation("'to' is before 'from'", { fields: { to: "before_start" } })
  if (Temporal.PlainDate.from(input.from).until(input.to).days > 93)
    throw new Validation("Range too large (max 3 months)", { fields: { to: "too_long" } })
  const people = calendarPeople(actor, input.teamId)
  const rows = people.map((u) => {
    const full = canViewUser(actor, u)
    return {
      user: { id: u.id, name: u.name, teamId: u.teamId },
      days: computeDays(u, input.from, input.to, { includePending: true }).map((d) => ({
        date: d.date,
        workday: d.isWorkday,
        holiday: d.holiday,
        // before a lead's cover started they see the team calendar like a colleague does
        absences: d.absences.map((x) => publicAbsence(x, full && seesDate(actor, u, d.date))),
      })),
    }
  })
  const shown = [...new Set(people.map((u) => u.teamId).filter((x): x is number => x != null))]
  const teamList = shown.length
    ? db
        .select({ id: teams.id, name: teams.name, color: teams.color })
        .from(teams)
        .where(inArray(teams.id, shown))
        .orderBy(asc(teams.name))
        .all()
    : []
  return { from: input.from, to: input.to, rows, teams: teamList }
}
export type TeamCalendar = ReturnType<typeof teamCalendar>
