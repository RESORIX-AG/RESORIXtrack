/**
 * Public holidays as seen by one person for the target-hour calculation. Which calendar applies today (own, team,
 * company default) is decided by applicableCalendar in holiday-calendars.ts, the same function behind the
 * person's Public holidays page; calendar CRUD and imports live there too. Earlier days use the calendar kept with
 * the person's earlier terms (services/terms.ts), so assigning another calendar (to the person, their team or the
 * company) never changes days before the change.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm"
import { db } from "../db"
import { type Holiday, holidays, type User, userTermsHistory } from "../db/schema"
import { addDays, monthBounds } from "../time"
import { applicableCalendar } from "./holiday-calendars"
import type { EarlierTerms } from "./timeline"

export function resolveCalendarId(user: Pick<User, "holidayCalendarId" | "teamId">): number | null {
  return applicableCalendar(user)?.calendar.id ?? null
}

interface CalendarSpan {
  from: string
  to: string
  calendarId: number | null
}

type EarlierCalendars = readonly Pick<EarlierTerms, "validUntil" | "holidayCalendarId">[]

function earlierCalendars(userId: number): EarlierCalendars {
  return db
    .select({ validUntil: userTermsHistory.validUntil, holidayCalendarId: userTermsHistory.holidayCalendarId })
    .from(userTermsHistory)
    .where(eq(userTermsHistory.userId, userId))
    .orderBy(asc(userTermsHistory.validUntil))
    .all()
}

/** The calendars that apply to `user` over [start, end]: those of the earlier terms (oldest first), then today's. */
function calendarSpans(
  user: Pick<User, "holidayCalendarId" | "teamId">,
  start: string,
  end: string,
  earlier: EarlierCalendars,
) {
  const spans: CalendarSpan[] = []
  let from = "0000-01-01"
  for (const r of earlier) {
    spans.push({ from, to: r.validUntil, calendarId: r.holidayCalendarId })
    from = addDays(r.validUntil, 1)
  }
  spans.push({ from, to: "9999-12-31", calendarId: resolveCalendarId(user) })
  for (const x of spans) {
    if (x.from < start) x.from = start
    if (x.to > end) x.to = end
  }
  return spans.filter((x) => x.from <= x.to)
}

/** The calendar recorded with a sign-off of `month`: the one that applies on its last day. */
export function monthCalendarId(
  user: Pick<User, "id" | "holidayCalendarId" | "teamId">,
  month: string,
  earlier: EarlierCalendars = earlierCalendars(user.id),
): number | null {
  const [, last] = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)))
  return calendarSpans(user, last, last, earlier)[0]?.calendarId ?? null
}

/** Holidays of a calendar in [start, end], keyed by date. */
export function calendarHolidays(calendarId: number | null, start: string, end: string): Map<string, Holiday> {
  const out = new Map<string, Holiday>()
  if (calendarId == null) return out
  const rows = db
    .select()
    .from(holidays)
    .where(and(eq(holidays.calendarId, calendarId), gte(holidays.date, start), lte(holidays.date, end)))
    .all()
  for (const h of rows) out.set(h.date, h)
  return out
}

/** Holidays that apply to `user` in [start, end], keyed by date. */
export function holidaysFor(
  user: Pick<User, "id" | "holidayCalendarId" | "teamId">,
  start: string,
  end: string,
  earlier: EarlierCalendars = earlierCalendars(user.id),
): Map<string, Holiday> {
  const out = new Map<string, Holiday>()
  for (const span of calendarSpans(user, start, end, earlier))
    for (const [d, h] of calendarHolidays(span.calendarId, span.from, span.to)) out.set(d, h)
  return out
}

export type Half = "am" | "pm"

/** Half-day holidays cover the afternoon (e.g. 24 Dec pm). */
export function holidayHalves(fraction: number): Half[] {
  if (fraction >= 1) return ["am", "pm"]
  if (fraction > 0) return ["pm"]
  return []
}
