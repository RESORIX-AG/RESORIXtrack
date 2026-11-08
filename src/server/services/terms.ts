/**
 * Keeping a person's earlier terms when they change from a day on (users.ts for the terms of one person; teams
 * and holiday calendars for changes that reach many people at once). The earlier row holds the values up to the
 * day before, the holiday calendar as it applied then (own, team's or the company default), so nothing that
 * happens later rewrites those days.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { db } from "../db"
import { teams, type User, users, userTermsHistory } from "../db/schema"
import { Conflict, Validation } from "../errors"
import { addDays, localToday } from "../time"
import { accountStart } from "./accounts"
import { resolveCalendarId } from "./holidays"
import { ensureAfterLastSignOff } from "./locks"
import { currentTerms, type PersonTimeline, personTimeline } from "./timeline"

/**
 * Changed terms apply from `from` (default today): the current ones are kept for the days before, unless they
 * only just started (`from` is their first day) or nothing was recorded yet. Returns the day they apply from.
 */
export function archiveTerms(
  u: User,
  from: string | null,
  timeline: PersonTimeline = personTimeline(u),
  calendarId: () => number | null = () => resolveCalendarId(u),
): string {
  const today = localToday(u.timezone)
  const day = from ?? today
  if (day > today) throw new Validation("Changes apply from today at the latest", { fields: { termsFrom: "future" } })
  ensureAfterLastSignOff(day, "termsFrom", u.id)
  const currentFrom = timeline.currentFrom ?? accountStart(u, timeline)
  if (day < currentFrom && timeline.currentFrom)
    throw new Conflict(`The current terms apply from ${currentFrom}; pick that day or later`, {
      code: "terms_order",
      fields: { termsFrom: "before_current" },
    })
  if (day > currentFrom)
    db.insert(userTermsHistory)
      .values({
        userId: u.id,
        validUntil: addDays(day, -1),
        ...currentTerms(u),
        holidayCalendarId: calendarId(),
      })
      .run()
  return day
}

/** Keep the earlier terms of everyone in `people` before a change that reaches them from today. */
export function archiveFromToday(people: User[]): void {
  // the calendar follows from the own and team calendar only, so people sharing both share it
  const calendars = new Map<string, number | null>()
  for (const u of people) {
    const key = `${u.holidayCalendarId}:${u.teamId}`
    archiveTerms(u, null, personTimeline(u), () => {
      if (!calendars.has(key)) calendars.set(key, resolveCalendarId(u))
      return calendars.get(key) ?? null
    })
  }
}

/** People whose holiday calendar comes from their team (`teamId`) or, with null, the company default. */
export function inheritingCalendar(teamId: number | null): User[] {
  const own = isNull(users.holidayCalendarId)
  if (teamId != null)
    return db
      .select()
      .from(users)
      .where(and(own, eq(users.teamId, teamId)))
      .all()
  const noTeamCalendar = or(
    isNull(users.teamId),
    sql`exists (select 1 from ${teams} where ${teams.id} = ${users.teamId} and ${teams.holidayCalendarId} is null)`,
  )
  return db.select().from(users).where(and(own, noTeamCalendar)).all()
}
