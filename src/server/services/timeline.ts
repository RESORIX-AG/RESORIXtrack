/**
 * A person over time: the terms that applied on each day (team, holiday calendar, timezone, vacation days,
 * legal weekly maximum, recording mode, exemption, regular night work) and the employment periods (rehiring). The `users` columns
 * hold the current terms and period; `user_terms_history` and `employment_history` the earlier ones, so a
 * change from a day on never rewrites the days before it.
 *
 * A day starts at midnight by the clock of the day before: when the timezone changes, the day before keeps its
 * end and the first day in the new timezone absorbs the difference (no minute is lost or counted twice).
 */
import { asc, eq } from "drizzle-orm"
import { db } from "../db"
import { employmentHistory, type User, userTermsHistory } from "../db/schema"
import { zone } from "../time"
import type { TERM_KEYS } from "./timeline.schemas"

export type Terms = Pick<User, (typeof TERM_KEYS)[number]>
export type TermKey = (typeof TERM_KEYS)[number]

export interface Period {
  start: string | null
  end: string | null
}

export interface EarlierTerms extends Terms {
  validUntil: string
}

export interface PersonTimeline {
  /** Terms in force on local day `date`. */
  termsOn: (date: string) => Terms
  tzOn: (date: string) => string
  /** Employment periods, oldest first; the last one is the current period. */
  periods: readonly Period[]
  employedOn: (date: string) => boolean
  /** Earlier terms, oldest first. */
  earlier: readonly EarlierTerms[]
  /** First day of the current terms (null: they always applied). */
  currentFrom: string | null
}

export function currentTerms(user: Terms): Terms {
  const { timezone, vacationDaysPerYear, legalWeeklyMaxHours, recordingMode, argExempt, regularNightWork } = user
  const { teamId, holidayCalendarId } = user
  return {
    timezone,
    vacationDaysPerYear,
    legalWeeklyMaxHours,
    recordingMode,
    argExempt,
    regularNightWork,
    teamId,
    holidayCalendarId,
  }
}

/** Pure: a timeline from the user row and its earlier terms and periods (tests, bulk loads). */
export function buildTimeline(
  user: Pick<User, TermKey | "employmentStart" | "employmentEnd">,
  earlier: readonly EarlierTerms[] = [],
  earlierPeriods: readonly { startDate: string; endDate: string }[] = [],
): PersonTimeline {
  const current = currentTerms(user)
  const sorted = [...earlier].sort((a, b) => (a.validUntil < b.validUntil ? -1 : 1))
  const periods: Period[] = [
    ...[...earlierPeriods]
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
      .map((p) => ({ start: p.startDate, end: p.endDate })),
    { start: user.employmentStart, end: user.employmentEnd },
  ]
  const termsOn = (date: string): Terms => sorted.find((t) => t.validUntil >= date) ?? current
  const last = sorted.at(-1)
  return {
    termsOn,
    tzOn: (date) => zone(termsOn(date).timezone),
    periods,
    employedOn: (d) => periods.some((p) => (!p.start || d >= p.start) && (!p.end || d <= p.end)),
    earlier: sorted,
    currentFrom: last ? Temporal.PlainDate.from(last.validUntil).add({ days: 1 }).toString() : null,
  }
}

export function personTimeline(user: User): PersonTimeline {
  const earlier = db
    .select()
    .from(userTermsHistory)
    .where(eq(userTermsHistory.userId, user.id))
    .orderBy(asc(userTermsHistory.validUntil))
    .all()
  const periods = db
    .select({ startDate: employmentHistory.startDate, endDate: employmentHistory.endDate })
    .from(employmentHistory)
    .where(eq(employmentHistory.userId, user.id))
    .orderBy(asc(employmentHistory.startDate))
    .all()
  return buildTimeline(user, earlier, periods)
}

/** Start instants (epoch ms) of `count` consecutive local days from `start` (23 h / 25 h days, timezone changes). */
export function dayStartsMs(start: string, count: number, tz: string | ((date: string) => string)): number[] {
  const out: number[] = []
  let d = Temporal.PlainDate.from(start)
  for (let i = 0; i < count; i++) {
    const zoneOfDay = typeof tz === "string" ? tz : tz(d.subtract({ days: 1 }).toString())
    out.push(d.toZonedDateTime({ timeZone: zoneOfDay }).epochMilliseconds)
    d = d.add({ days: 1 })
  }
  return out
}

/** [start, end) of local day `d` as epoch ms. */
export function dayBoundsMs(d: string, tzOn: (date: string) => string): [number, number] {
  const [a, b] = dayStartsMs(d, 2, tzOn)
  return [a, b]
}

/** The local day an instant (epoch ms) belongs to. */
export function dayOfMs(ms: number, tzOn: (date: string) => string): string {
  let d = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tzOn("9999-12-31")).toPlainDate()
  for (let i = 0; i < 4; i++) {
    const [a, b] = dayBoundsMs(d.toString(), tzOn)
    if (ms < a) d = d.subtract({ days: 1 })
    else if (ms >= b) d = d.add({ days: 1 })
    else return d.toString()
  }
  return d.toString()
}
