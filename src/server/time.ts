/**
 * Time helpers (server). Storage is UTC (`instant` text, see db/columns.ts); calendar days are evaluated in
 * the person's timezone. Uses the built-in Temporal API (Node >= 24 with Temporal, see package.json engines).
 *
 * Conventions: a *day* is a `YYYY-MM-DD` string, an *instant* a fixed-width ISO string with microseconds.
 */
import { toInstant } from "./db/columns"

export const DEFAULT_TZ = "Europe/Zurich"

let frozen: Temporal.Instant | null = null

/** Test helper: pin the clock used by all services (`null` releases it). */
export function freeze(at: string | null): void {
  frozen = at ? Temporal.Instant.from(at) : null
}

export function nowInstant(): Temporal.Instant {
  return frozen ?? Temporal.Now.instant()
}

/** Current time as stored instant string. */
export function utcnow(): string {
  return fmtInstant(nowInstant())
}

export function fmtInstant(i: Temporal.Instant): string {
  return i.toString({ smallestUnit: "microsecond" })
}

/** Stored instant of epoch milliseconds. */
export const instantOfMs = (n: number): string => new Date(n).toISOString().replace("Z", "000Z")

export function parseInstant(s: string): Temporal.Instant {
  return Temporal.Instant.from(s)
}

export function normalizeInstant(v: string | Date): string {
  return toInstant(v)
}

export function isValidTz(name: string): boolean {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(name)
    return true
  } catch {
    return false
  }
}

export function zone(name: string | null | undefined): string {
  return name && isValidTz(name) ? name : DEFAULT_TZ
}

export function allTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone")
}

export function localToday(tz: string): string {
  return nowInstant().toZonedDateTimeISO(zone(tz)).toPlainDate().toString()
}

export function localDateOf(at: string, tz: string): string {
  return parseInstant(at).toZonedDateTimeISO(zone(tz)).toPlainDate().toString()
}

/** Local wall-clock `HH:MM` of an instant (string or epoch ms). */
export function localClock(at: string | number, tz: string): string {
  const i = typeof at === "number" ? Temporal.Instant.fromEpochMilliseconds(at) : parseInstant(at)
  return i.toZonedDateTimeISO(zone(tz)).toPlainTime().toString({ smallestUnit: "minute" })
}

/** [start, end) of local calendar day `d` as instants (handles 23h/25h DST days). */
export function dayBoundsUtc(d: string, tz: string): [string, string] {
  const z = zone(tz)
  const pd = Temporal.PlainDate.from(d)
  const start = pd.toZonedDateTime({ timeZone: z }).toInstant()
  const end = pd.add({ days: 1 }).toZonedDateTime({ timeZone: z }).toInstant()
  return [fmtInstant(start), fmtInstant(end)]
}

/** [start of `start`, end of `end`) for an inclusive day range. */
export function rangeBoundsUtc(start: string, end: string, tz: string): [string, string] {
  return [dayBoundsUtc(start, tz)[0], dayBoundsUtc(end, tz)[1]]
}

/** Local wall-clock `HH:MM` on day `d` in `tz` as instant. */
export function localToInstant(d: string, hhmm: string, tz: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  const zdt = Temporal.PlainDate.from(d).toZonedDateTime({ timeZone: zone(tz), plainTime: { hour: h, minute: m } })
  return fmtInstant(zdt.toInstant())
}

export function* daterange(start: string, end: string): Generator<string> {
  let d = Temporal.PlainDate.from(start)
  const e = Temporal.PlainDate.from(end)
  while (Temporal.PlainDate.compare(d, e) <= 0) {
    yield d.toString()
    d = d.add({ days: 1 })
  }
}

export function addDays(d: string, n: number): string {
  return Temporal.PlainDate.from(d).add({ days: n }).toString()
}

/** 0 = Monday … 6 = Sunday (Python's `weekday()`). */
export function weekday(d: string): number {
  return Temporal.PlainDate.from(d).dayOfWeek - 1
}

export function minutesBetween(a: string, b: string): number {
  const ms = parseInstant(b).epochMilliseconds - parseInstant(a).epochMilliseconds
  return Math.max(0, ms / 60000)
}

export function monthBounds(year: number, month: number): [string, string] {
  const start = Temporal.PlainDate.from({ year, month, day: 1 })
  return [start.toString(), start.add({ months: 1 }).subtract({ days: 1 }).toString()]
}

export function monthKey(d: string): string {
  return d.slice(0, 7)
}

export function compareDay(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Start of the ISO week (Monday) containing `d`. */
export function weekStart(d: string): string {
  return addDays(d, -weekday(d))
}

/** API representation of an instant: ISO with millisecond precision and `Z`. */
export function iso(at: string): string
export function iso(at: string | null | undefined): string | null
export function iso(at: string | null | undefined): string | null {
  if (!at) return null
  return parseInstant(at).toString({ smallestUnit: "millisecond" })
}
