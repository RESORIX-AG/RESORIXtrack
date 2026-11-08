import { dateFormat, fmtDays } from "@/lib/format"
import { type Locale, makeI18n } from "@/lib/i18n-core"
import { localClock } from "@/server/time"

/** Translations and number formats for exported files (always in the requester's locale). */
export function exportI18n(locale: Locale) {
  const i = makeI18n(locale)
  const L = (key: string, vars?: Record<string, string | number>) => i.t(`reports.pdf.${key}`, vars)
  const monthFmt = dateFormat(i.intl, { month: "long", year: "numeric", timeZone: "UTC" })
  const weekdayFmt = dateFormat(i.intl, { weekday: "short", timeZone: "UTC" })
  const dateFmt = dateFormat(i.intl, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  })
  return {
    ...i,
    L,
    month: (year: number, month: number) => monthFmt.format(new Date(Date.UTC(year, month - 1, 1))),
    weekday: (d: string) => weekdayFmt.format(new Date(`${d}T12:00:00Z`)),
    date: (d: string) => dateFmt.format(new Date(`${d}T12:00:00Z`)),
    days: fmtDays,
    status: (s: string) => L(`status_${s}`),
  }
}
export type ExportI18n = ReturnType<typeof exportI18n>

/**
 * h:mm with an ASCII sign: the PDF's standard fonts only cover WinAnsi, which has no U+2212 minus.
 */
export function hm(min: number | null | undefined, sign = false): string {
  if (min == null || Number.isNaN(min)) return ""
  const total = Math.round(min)
  const abs = Math.abs(total)
  const s = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`
  if (total < 0) return `-${s}`
  return sign && total > 0 ? `+${s}` : s
}

/** HH:MM wall time of an instant in a timezone. */
export function wallTime(at: string | null | undefined, tz: string): string {
  return at ? localClock(at, tz) : ""
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "report"
  )
}
