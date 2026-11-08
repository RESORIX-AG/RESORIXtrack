/**
 * Client-side wall-clock helpers for a person's timezone (Intl only; browsers without Temporal work too).
 * Days are `YYYY-MM-DD`, times of day `HH:MM` (24 h); formatting honours the profile's 12/24 h setting.
 */
import { dayOf } from "@/lib/format"

const partsFmt = new Map<string, Intl.DateTimeFormat>()
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    partsFmt.set(tz, f)
  }
  return f
}

/** Local date, time of day and seconds of an instant in `tz`. */
export function wallClock(at: string | number | Date, tz: string): { date: string; time: string; seconds: number } {
  const p: Record<string, string> = {}
  for (const x of fmtFor(tz).formatToParts(new Date(at))) p[x.type] = x.value
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, seconds: Number(p.second) }
}

export const todayIn = (tz: string): string => dayOf(new Date(), tz)

/** Minutes since local midnight of an instant. */
export function minutesOfDay(at: string | number | Date, tz: string): number {
  const { time } = wallClock(at, tz)
  return hhmmToMin(time)
}

export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

export function minToHhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/**
 * Times a new entry starts with: the given start, else the quarter hour nearest to now, and an hour later.
 * Entries never end in the future, so on today an end after now is left empty for the person to pick.
 */
export function newEntryTimes(nowMin: number, today: boolean, start?: string): { start: string; end: string } {
  const from = start ?? minToHhmm(Math.min(Math.round(nowMin / 15) * 15, 23 * 60 + 45))
  const end = Math.min(hhmmToMin(from) + 60, 23 * 60 + 59)
  return { start: from, end: today && end > nowMin ? "" : minToHhmm(end) }
}

/** The instant (ISO, UTC) of a local wall-clock time in `tz` (DST gaps resolve forward). */
export function wallToInstant(date: string, hhmm: string, tz: string): string {
  const [y, mo, d] = date.split("-").map(Number)
  const [h, mi] = hhmm.split(":").map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const offsetAt = (ms: number) => {
    const w = wallClock(ms, tz)
    const [wy, wmo, wd] = w.date.split("-").map(Number)
    const [wh, wmi] = w.time.split(":").map(Number)
    return Date.UTC(wy, wmo - 1, wd, wh, wmi, w.seconds) - Math.floor(ms / 1000) * 1000
  }
  let t = guess - offsetAt(guess)
  t = guess - offsetAt(t)
  return new Date(t).toISOString()
}

/** "HH:MM" → display text in the person's format. */
export function fmtClockTime(hhmm: string | null | undefined, hour12: boolean): string {
  if (!hhmm) return "–"
  if (!hour12) return hhmm
  const [h, m] = hhmm.split(":").map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

/** Lenient parse of a typed time: "9", "930", "9:30", "9.30", "09:30", "9:30 pm". Returns "HH:MM" or null. */
export function parseTimeText(text: string): string | null {
  const s = text.trim().toLowerCase()
  if (!s) return null
  const m = s.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*([ap])?\.?m?\.?$/)
  if (!m) return null
  let h = Number(m[1])
  const mi = m[2] ? Number(m[2]) : 0
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3] === "p" ? 12 : 0)
  }
  if (h > 23 || mi > 59) return null
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`
}

/** "7:30", "7.5", "7,5", "450m" → minutes; null when unreadable. */
export function parseDuration(text: string): number | null {
  const s = text.trim().replace(",", ".")
  if (!s) return null
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = s.match(/^(\d{1,4})\s*m(in)?$/i)
  if (m) return Number(m[1])
  m = s.match(/^\d{1,2}(\.\d+)?$/)
  if (m) return Math.round(Number(s) * 60)
  return null
}
