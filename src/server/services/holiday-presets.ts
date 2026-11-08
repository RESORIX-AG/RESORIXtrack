/**
 * Swiss holiday presets, one per canton, built on date-holidays only (no holiday data is maintained here).
 * A canton's days are statutory (always in a calendar) or selectable: optional days the company decides on,
 * and days that do not apply in some communes. A calendar keeps its ticked selectable days in `preset_days`
 * by their English name, which is stable across years. Pure: no database access.
 */
import Holidays from "date-holidays"
import { DEFAULT_LOCALE, isSupportedLocale } from "@/lib/locales"
import { Validation } from "../errors"
import { nowInstant } from "../time"

export interface PresetDay {
  date: string
  name: string
  fraction: number
}

export type SelectableKind = "optional" | "commune"

export interface SelectableDay extends PresetDay {
  kind: SelectableKind
  /** communes where a commune day does not apply */
  exceptIn: string[]
}

export interface HolidayPreset {
  key: string // "CH-ZH"
  label: string
  /** this year's days, for the preset picker */
  statutory: PresetDay[]
  selectable: SelectableDay[]
  /** the selectable days ticked when the preset is picked */
  defaultDays: string[]
}

/** Local or non-English names from date-holidays mapped to one English name (translated in the UI). */
const CANONICAL: Record<string, string> = {
  Bundesfeiertag: "Swiss National Day",
  "Fête nationale": "Swiss National Day",
  "Giorno festivo federale": "Swiss National Day",
  Assumption: "Assumption Day",
  "Saint-Berthold": "Berchtold's Day",
  Berchtoldstag: "Berchtold's Day",
  "2 Janvier": "Berchtold's Day",
  "Jeûne Genevois": "Geneva Fast",
  "Instauration de la République": "Republic Day",
  Mauritiustag: "St. Maurice's Day",
}
const ALWAYS_SUNDAY = new Set([
  "Easter Sunday",
  "Pentecost",
  "Federal Day of Thanksgiving, Repentance and Prayer",
  "Mother's Day",
  "Father's Day",
])
export const FEDERAL_DAY = "08-01" // Bundesfeiertag, the only federal public holiday (ArG Art. 20a para. 1)

const lang = (locale?: string) => (isSupportedLocale(locale) ? locale : DEFAULT_LOCALE)

const currentYear = () => nowInstant().toZonedDateTimeISO(Temporal.Now.timeZoneId()).year

/** The 26 cantons (code without "CH-"), named in the given language. */
export function cantons(locale?: string): { code: string; name: string }[] {
  const states = (new Holidays().getStates("CH", lang(locale)) ?? {}) as Record<string, string>
  return Object.entries(states)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
}

function cantonOf(key: string): string | null {
  const m = key.match(/^CH-([A-Z]{2})$/)
  return m && cantons().some((c) => c.code === m[1]) ? m[1] : null
}

export function isPresetKey(key: string): boolean {
  return cantonOf(key) != null
}

/** "excluding communities: Murten, Kerzers" → ["Murten", "Kerzers"] */
function communesOf(note: string | undefined): string[] {
  if (!note || !/communit/i.test(note)) return []
  return note
    .slice(note.indexOf(":") + 1)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
}

interface CantonYear {
  statutory: PresetDay[]
  selectable: SelectableDay[]
}

function cantonYear(canton: string, year: number): CantonYear {
  const statutory = new Map<string, PresetDay>()
  const selectable = new Map<string, SelectableDay>()
  for (const h of new Holidays("CH", canton, { types: ["public", "optional"] }).getHolidays(year, "en") ?? []) {
    if (h.type !== "public" && h.type !== "optional") continue
    const name = CANONICAL[h.name] ?? h.name
    if (ALWAYS_SUNDAY.has(name)) continue
    const date = h.date.slice(0, 10)
    if (statutory.has(date) || selectable.has(date)) continue
    // a day that starts in the afternoon (Knabenschiessen from 13:00) is a half day
    const day = { date, name, fraction: h.date.slice(11, 16) === "00:00" ? 1 : 0.5 }
    // date-holidays sets `note` at runtime but leaves it out of its types
    const exceptIn = communesOf("note" in h && typeof h.note === "string" ? h.note : undefined)
    if (h.type === "public" && !exceptIn.length) statutory.set(date, day)
    else selectable.set(date, { ...day, kind: h.type === "optional" ? "optional" : "commune", exceptIn })
  }
  const byDate = (a: PresetDay, b: PresetDay) => a.date.localeCompare(b.date)
  return { statutory: [...statutory.values()].sort(byDate), selectable: [...selectable.values()].sort(byDate) }
}

function requireCanton(key: string): string {
  const canton = cantonOf(key)
  if (!canton) throw new Validation("Unknown preset", { fields: { preset: "invalid" } })
  return canton
}

export function selectableDays(key: string, year: number): SelectableDay[] {
  return cantonYear(requireCanton(key), year).selectable
}

/** A preset's holidays in a year: the statutory days plus the ticked selectable days (English names). */
export function presetHolidays(key: string, year: number, presetDays: readonly string[]): PresetDay[] {
  const { statutory, selectable } = cantonYear(requireCanton(key), year)
  const ticked = new Set(presetDays)
  const days: PresetDay[] = [...statutory]
  for (const d of selectable) if (ticked.has(d.name)) days.push({ date: d.date, name: d.name, fraction: d.fraction })
  return days.sort((a, b) => a.date.localeCompare(b.date))
}

/** Ticked by default: commune days (they apply in most of the canton); optional days are the company's call. */
function ticksByDefault(selectable: readonly SelectableDay[]): string[] {
  return selectable.filter((d) => d.kind === "commune").map((d) => d.name)
}

export function defaultPresetDays(key: string, year: number = currentYear()): string[] {
  return isPresetKey(key) ? ticksByDefault(selectableDays(key, year)) : []
}

/** The ticked days, deduplicated; a name that is not selectable in the preset is a field error. */
export function checkPresetDays(key: string, presetDays: readonly string[], year: number): string[] {
  if (!presetDays.length) return []
  const known = new Set([year, year + 1].flatMap((y) => selectableDays(key, y).map((d) => d.name)))
  if (presetDays.some((n) => !known.has(n)))
    throw new Validation("Unknown holiday for this canton", { fields: { presetDays: "invalid" } })
  return [...new Set(presetDays)]
}

/** A preset calendar's name: the canton in the given language ("Kanton Freiburg"). */
export function presetName(key: string, locale?: string): string {
  const code = cantonOf(key)
  return cantons(locale).find((c) => c.code === code)?.name ?? key
}

/** The name earlier versions gave preset calendars ("CH-FR Canton of Fribourg"). */
export function legacyPresetName(key: string): string {
  return `${key} ${presetName(key)}`
}

export function holidayPresets(locale?: string, year: number = currentYear()): HolidayPreset[] {
  return cantons(locale).map((c) => {
    const { statutory, selectable } = cantonYear(c.code, year)
    return { key: `CH-${c.code}`, label: c.name, statutory, selectable, defaultDays: ticksByDefault(selectable) }
  })
}
