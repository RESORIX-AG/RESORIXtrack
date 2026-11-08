/**
 * Public-holiday calendars: CRUD, canton presets (holiday-presets.ts) with their ticked optional and commune
 * days, optional company days and the yearly top-up of preset calendars. A calendar made from a preset keeps
 * the preset key in `region_code` and its ticked days in `preset_days`. Holiday names are stored in English
 * and translated in the UI through the `holidays` i18n namespace. Every holiday change is a revision.
 * Holidays inside signed-off months are frozen (locks.ensureHolidayChangeAllowed + database triggers).
 */
import { and, asc, count, eq, gte, inArray, lt, lte, max, min, sql } from "drizzle-orm"
import { db } from "../db"
import {
  type Holiday,
  type HolidayCalendar,
  holidayCalendars,
  holidays,
  notifications,
  teams,
  type User,
  users,
  userTermsHistory,
} from "../db/schema"
import { Conflict, NotFound, Validation } from "../errors"
import { localToday } from "../time"
import type { CompanyDayKey } from "./holiday-calendars.schemas"
import {
  checkPresetDays,
  FEDERAL_DAY,
  isPresetKey,
  legacyPresetName,
  type PresetDay,
  presetHolidays,
  presetName,
  selectableDays,
} from "./holiday-presets"
import { ensureHolidayChangeAllowed, latestSignedDate } from "./locks"
import { notify } from "./notifications"
import { type Actor, requireAdmin } from "./permissions"
import { record, snapshot } from "./revisions"
import { getSetting } from "./settings"
import { archiveFromToday, inheritingCalendar } from "./terms"

export type HolidayKind = "federal" | "cantonal" | "company"

/** Who changes holidays: an administrator, or the worker, CLI, setup or demo seed without one. */
export interface ChangeSource {
  actor: Actor | null
  source?: string
}

function logHoliday(by: ChangeSource, action: "create" | "update" | "delete", row: Holiday, before: Holiday | null) {
  record({
    entity: "holiday",
    row,
    action,
    actor: by.actor,
    subjectUserId: null,
    before: before ? snapshot("holiday", before) : null,
    source: by.source,
  })
}

function removeHoliday(by: ChangeSource, h: Holiday) {
  db.delete(holidays).where(eq(holidays.id, h.id)).run()
  logHoliday(by, "delete", h, h)
}

function thisYear(): number {
  return Number(localToday(getSetting("default_timezone")).slice(0, 4))
}

/**
 * Create a calendar from a preset for the given years (default: this and next year) with the ticked days.
 * Re-running adds missing dates; an existing calendar of the same name keeps its ticked days.
 */
export function createCalendarFromPreset(
  key: string,
  opts: { years?: number[]; makeDefault?: boolean; presetDays?: readonly string[] } & Partial<ChangeSource> = {},
): HolidayCalendar {
  if (!isPresetKey(key)) throw new Validation("Unknown preset", { fields: { preset: "invalid" } })
  const years = opts.years ?? [thisYear(), thisYear() + 1]
  const presetDays = checkPresetDays(key, opts.presetDays ?? [], thisYear())
  const name = presetName(key, getSetting("default_locale"))
  let cal =
    db
      .select()
      .from(holidayCalendars)
      .where(inArray(holidayCalendars.name, [name, legacyPresetName(key)]))
      .orderBy(holidayCalendars.id)
      .get() ?? db.insert(holidayCalendars).values({ name, regionCode: key, presetDays }).returning().get()
  const ticked = cal.presetDays
  insertMissing(
    cal.id,
    years.flatMap((y) => presetHolidays(key, y, ticked)),
    { actor: opts.actor ?? null, source: opts.source },
  )
  if (opts.makeDefault) cal = makeDefault(cal.id)
  return cal
}

function insertMissing(calendarId: number, items: PresetDay[], by: ChangeSource): { added: number; skipped: number } {
  const latest = latestSignedDate()
  const dates = items.map((i) => i.date)
  const existing = new Set(
    dates.length
      ? db
          .select({ d: holidays.date })
          .from(holidays)
          .where(and(eq(holidays.calendarId, calendarId), inArray(holidays.date, dates)))
          .all()
          .map((r) => r.d)
      : [],
  )
  let added = 0
  let skipped = 0
  for (const it of items) {
    if (existing.has(it.date) || (latest != null && it.date <= latest)) {
      skipped++
      continue
    }
    const row = db
      .insert(holidays)
      .values({ calendarId, date: it.date, name: it.name.slice(0, 120), fraction: it.fraction })
      .returning()
      .get()
    logHoliday(by, "create", row, null)
    existing.add(it.date)
    added++
  }
  return { added, skipped }
}

function makeDefault(calendarId: number): HolidayCalendar {
  const current = db.select().from(holidayCalendars).where(eq(holidayCalendars.isDefault, true)).get()
  // people on the company default switch from today; earlier days keep the old one
  if (current?.id !== calendarId) archiveFromToday(inheritingCalendar(null))
  db.update(holidayCalendars).set({ isDefault: false }).where(eq(holidayCalendars.isDefault, true)).run()
  return db
    .update(holidayCalendars)
    .set({ isDefault: true })
    .where(eq(holidayCalendars.id, calendarId))
    .returning()
    .get()
}

// ------------------------------------------------------------------ calendars

export function listCalendars(actor: Actor) {
  requireAdmin(actor)
  const cals = db.select().from(holidayCalendars).orderBy(asc(holidayCalendars.name)).all()
  const stats = new Map(
    db
      .select({ id: holidays.calendarId, n: count(), first: min(holidays.date), last: max(holidays.date) })
      .from(holidays)
      .groupBy(holidays.calendarId)
      .all()
      .map((r) => [r.id, r]),
  )
  const userCounts = new Map(
    db
      .select({ id: users.holidayCalendarId, n: count() })
      .from(users)
      .groupBy(users.holidayCalendarId)
      .all()
      .map((r) => [r.id, r.n]),
  )
  const teamCounts = new Map(
    db
      .select({ id: teams.holidayCalendarId, n: count() })
      .from(teams)
      .groupBy(teams.holidayCalendarId)
      .all()
      .map((r) => [r.id, r.n]),
  )
  return cals.map((c) => {
    const s = stats.get(c.id)
    return {
      id: c.id,
      name: c.name,
      regionCode: c.regionCode,
      hasPreset: isPresetKey(c.regionCode),
      presetDays: c.presetDays,
      description: c.description,
      isDefault: c.isDefault,
      holidayCount: s?.n ?? 0,
      firstYear: s?.first ? Number(s.first.slice(0, 4)) : null,
      lastYear: s?.last ? Number(s.last.slice(0, 4)) : null,
      userCount: userCounts.get(c.id) ?? 0,
      teamCount: teamCounts.get(c.id) ?? 0,
    }
  })
}
export type CalendarRow = ReturnType<typeof listCalendars>[number]

function getCalendar(id: number): HolidayCalendar {
  const c = db.select().from(holidayCalendars).where(eq(holidayCalendars.id, id)).get()
  if (!c) throw new NotFound("Holiday calendar not found")
  return c
}

function holidaysOfYear(calendarId: number, year: number): Holiday[] {
  return db
    .select()
    .from(holidays)
    .where(
      and(
        eq(holidays.calendarId, calendarId),
        gte(holidays.date, `${year}-01-01`),
        lte(holidays.date, `${year}-12-31`),
      ),
    )
    .orderBy(asc(holidays.date))
    .all()
}

export function calendarYear(actor: Actor, calendarId: number, year: number): Holiday[] {
  requireAdmin(actor)
  getCalendar(calendarId)
  return holidaysOfYear(calendarId, year)
}

// ------------------------------------------------------------------ the calendar that applies to a person

export type CalendarSource = "user" | "team" | "default"

export interface ApplicableCalendar {
  calendar: HolidayCalendar
  source: CalendarSource
  /** The team whose calendar applies (source "team"). */
  team: { id: number; name: string } | null
}

/**
 * The calendar that applies to a person: their own, else their team's, else the company default. Target hours
 * (holidays.ts) and the person's Public holidays page resolve through this one function, so what people see
 * is what reduces their target.
 */
export function applicableCalendar(user: Pick<User, "holidayCalendarId" | "teamId">): ApplicableCalendar | null {
  if (user.holidayCalendarId != null) {
    const own = db.select().from(holidayCalendars).where(eq(holidayCalendars.id, user.holidayCalendarId)).get()
    if (own) return { calendar: own, source: "user", team: null }
  }
  if (user.teamId != null) {
    const row = db
      .select({ team: { id: teams.id, name: teams.name }, calendar: holidayCalendars })
      .from(teams)
      .innerJoin(holidayCalendars, eq(holidayCalendars.id, teams.holidayCalendarId))
      .where(eq(teams.id, user.teamId))
      .get()
    if (row) return { calendar: row.calendar, source: "team", team: row.team }
  }
  const def = db.select().from(holidayCalendars).where(eq(holidayCalendars.isDefault, true)).limit(1).get()
  return def ? { calendar: def, source: "default", team: null } : null
}

/** Everyone whose applicable calendar (own, else team's, else the default, as in applicableCalendar) is `calendarId`. */
function peopleOnCalendar(calendarId: number): User[] {
  const own = sql`(select ${holidayCalendars.id} from ${holidayCalendars} where ${holidayCalendars.id} = ${users.holidayCalendarId})`
  const team = sql`(select ${holidayCalendars.id} from ${teams} join ${holidayCalendars} on ${holidayCalendars.id} = ${teams.holidayCalendarId} where ${teams.id} = ${users.teamId})`
  const fallback = sql`(select ${holidayCalendars.id} from ${holidayCalendars} where ${eq(holidayCalendars.isDefault, true)} limit 1)`
  return db.select().from(users).where(sql`coalesce(${own}, ${team}, ${fallback}) = ${calendarId}`).all()
}

/** Years with at least one holiday, ascending. */
function calendarYears(calendarId: number): number[] {
  const year = sql<string>`substr(${holidays.date}, 1, 4)`
  return db
    .select({ year })
    .from(holidays)
    .where(eq(holidays.calendarId, calendarId))
    .groupBy(year)
    .orderBy(year)
    .all()
    .map((r) => Number(r.year))
}

/**
 * The person's own Public holidays page: the calendar that applies to them and its holidays of one year
 * (default: their current year). Read-only for every role; never another person's data. Null when no
 * calendar is configured for them, their team or the company.
 */
export function myHolidays(actor: Actor, year?: number) {
  const applicable = applicableCalendar(actor.user)
  if (!applicable) return null
  const { calendar, source, team } = applicable
  const current = Number(localToday(actor.user.timezone).slice(0, 4))
  const shown = year ?? current
  const years = [...new Set([...calendarYears(calendar.id), current, current + 1, shown])].sort((a, b) => a - b)
  return {
    calendar: {
      id: calendar.id,
      name: calendar.name,
      regionCode: calendar.regionCode,
      description: calendar.description,
      isDefault: calendar.isDefault,
    },
    source,
    team,
    year: shown,
    years,
    holidays: holidaysOfYear(calendar.id, shown).map((h) => ({
      id: h.id,
      date: h.date,
      name: h.name,
      fraction: h.fraction,
    })),
  }
}
export type MyHolidays = NonNullable<ReturnType<typeof myHolidays>>

export interface CalendarInput {
  name: string
  regionCode: string
  /** ticked optional and commune days of the preset */
  presetDays: string[]
  description: string
  isDefault: boolean
}

/** A new calendar with a preset gets the preset's holidays for this year and next. */
export function saveCalendar(actor: Actor, input: CalendarInput, id?: number): HolidayCalendar {
  requireAdmin(actor)
  const name = input.name.trim()
  if (!name || name.length > 120)
    throw new Validation("Name is required", { fields: { name: name ? "too_long" : "required" } })
  const clash = db
    .select({ id: holidayCalendars.id })
    .from(holidayCalendars)
    .where(eq(holidayCalendars.name, name))
    .get()
  if (clash && clash.id !== id)
    throw new Conflict("A calendar with this name already exists", { fields: { name: "taken" } })
  const regionCode = input.regionCode.trim()
  if (regionCode && !isPresetKey(regionCode))
    throw new Validation("Unknown preset", { fields: { regionCode: "invalid" } })
  const presetDays = regionCode ? checkPresetDays(regionCode, input.presetDays, thisYear()) : []
  const before = id != null ? getCalendar(id) : null
  const values = {
    name,
    regionCode,
    presetDays,
    description: input.description.trim().slice(0, 500),
  }
  let cal =
    id != null
      ? db.update(holidayCalendars).set(values).where(eq(holidayCalendars.id, id)).returning().get()
      : db.insert(holidayCalendars).values(values).returning().get()
  if (before && regionCode && before.regionCode === regionCode)
    applyPresetDayChange(actor, cal.id, regionCode, before.presetDays, presetDays)
  else if (!before && regionCode) {
    const y = thisYear()
    insertMissing(
      cal.id,
      [y, y + 1].flatMap((year) => presetHolidays(regionCode, year, presetDays)),
      { actor },
    )
  }
  const anyDefault = db
    .select({ id: holidayCalendars.id })
    .from(holidayCalendars)
    .where(eq(holidayCalendars.isDefault, true))
    .get()
  if (input.isDefault || !anyDefault) cal = makeDefault(cal.id)
  else if (cal.isDefault && !input.isDefault) {
    archiveFromToday(inheritingCalendar(null))
    cal = db.update(holidayCalendars).set({ isDefault: false }).where(eq(holidayCalendars.id, cal.id)).returning().get()
  }
  return cal
}

/**
 * Ticking or unticking a preset day changes that day from today on, in the years the calendar holds, never
 * inside a signed-off month. A removal matches the preset's date and name, so days edited by hand stay.
 */
function applyPresetDayChange(
  actor: Actor,
  calendarId: number,
  key: string,
  before: readonly string[],
  after: readonly string[],
) {
  const added = new Set(after.filter((n) => !before.includes(n)))
  const removed = new Set(before.filter((n) => !after.includes(n)))
  if (!added.size && !removed.size) return
  const today = localToday(getSetting("default_timezone"))
  const latest = latestSignedDate()
  const days = calendarYears(calendarId)
    .filter((y) => y >= Number(today.slice(0, 4)))
    .flatMap((y) => selectableDays(key, y))
    .filter((d) => d.date >= today && (latest == null || d.date > latest))
  const by = { actor }
  insertMissing(
    calendarId,
    days.filter((d) => added.has(d.name)).map(({ date, name, fraction }) => ({ date, name, fraction })),
    by,
  )
  const gone = new Map(days.filter((d) => removed.has(d.name)).map((d) => [d.date, d.name]))
  if (!gone.size) return
  const rows = db
    .select()
    .from(holidays)
    .where(and(eq(holidays.calendarId, calendarId), inArray(holidays.date, [...gone.keys()])))
    .all()
  for (const h of rows) if (gone.get(h.date) === h.name) removeHoliday(by, h)
}

export function setDefaultCalendar(actor: Actor, id: number): HolidayCalendar {
  requireAdmin(actor)
  return makeDefault(getCalendar(id).id)
}

/**
 * Deleting removes its holidays; teams and people fall back to the next calendar (ON DELETE SET NULL). A calendar
 * that counted for days already passed stays: removing it would rewrite those days.
 */
export function deleteCalendar(actor: Actor, id: number): void {
  requireAdmin(actor)
  const cal = getCalendar(id)
  const people = peopleOnCalendar(cal.id)
  if (calendarCountedBefore(cal.id, localToday(getSetting("default_timezone")), people.length > 0))
    throw new Conflict("This calendar counted for days already passed and can no longer be deleted", {
      code: "calendar_in_use",
    })
  const latest = latestSignedDate()
  if (latest != null) {
    const frozen = db
      .select({ d: holidays.date })
      .from(holidays)
      .where(and(eq(holidays.calendarId, cal.id), lte(holidays.date, latest)))
      .get()
    if (frozen) ensureHolidayChangeAllowed(frozen.d)
  }
  // its people fall back to another calendar from today
  archiveFromToday(people)
  for (const h of db.select().from(holidays).where(eq(holidays.calendarId, cal.id)).all()) removeHoliday({ actor }, h)
  db.delete(holidayCalendars).where(eq(holidayCalendars.id, cal.id)).run()
}

/** Did the calendar have holidays before `today` while someone counted with it (now or in earlier terms)? */
function calendarCountedBefore(calendarId: number, today: string, countsNow: boolean): boolean {
  const past = db
    .select({ d: holidays.date })
    .from(holidays)
    .where(and(eq(holidays.calendarId, calendarId), lt(holidays.date, today)))
    .get()
  if (!past) return false
  if (countsNow) return true
  return (
    db
      .select({ id: userTermsHistory.id })
      .from(userTermsHistory)
      .where(eq(userTermsHistory.holidayCalendarId, calendarId))
      .get() != null
  )
}

// ------------------------------------------------------------------ holidays

export interface HolidayInput {
  date: string
  name: string
  fraction: number
}

export function saveHoliday(actor: Actor, calendarId: number, input: HolidayInput, id?: number): Holiday {
  requireAdmin(actor)
  getCalendar(calendarId)
  const fields: Record<string, string> = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fields.date = "invalid"
  if (!input.name.trim()) fields.name = "required"
  if (input.fraction !== 1 && input.fraction !== 0.5) fields.fraction = "invalid"
  if (Object.keys(fields).length) throw new Validation("Please check your input", { fields })
  ensureHolidayChangeAllowed(input.date)
  const existing =
    id != null
      ? db
          .select()
          .from(holidays)
          .where(and(eq(holidays.id, id), eq(holidays.calendarId, calendarId)))
          .get()
      : undefined
  if (id != null && !existing) throw new NotFound("Holiday not found")
  if (existing) ensureHolidayChangeAllowed(existing.date)
  const clash = db
    .select({ id: holidays.id })
    .from(holidays)
    .where(and(eq(holidays.calendarId, calendarId), eq(holidays.date, input.date)))
    .get()
  if (clash && clash.id !== id)
    throw new Conflict("There is already a holiday on this date", { fields: { date: "taken" } })
  const values = { date: input.date, name: input.name.trim().slice(0, 120), fraction: input.fraction }
  const row = existing
    ? db.update(holidays).set(values).where(eq(holidays.id, existing.id)).returning().get()
    : db
        .insert(holidays)
        .values({ calendarId, ...values })
        .returning()
        .get()
  logHoliday({ actor }, existing ? "update" : "create", row, existing ?? null)
  return row
}

export function deleteHoliday(actor: Actor, holidayId: number): Holiday {
  requireAdmin(actor)
  const h = db.select().from(holidays).where(eq(holidays.id, holidayId)).get()
  if (!h) throw new NotFound("Holiday not found")
  ensureHolidayChangeAllowed(h.date)
  removeHoliday({ actor }, h)
  return h
}

export interface ImportInput {
  preset: string
  presetDays: string[]
  year: number
  replace: boolean
}

/**
 * Import a preset's holidays of one year with the ticked days into a calendar. A calendar without a preset
 * takes on the preset and its ticked days.
 */
export function importPreset(actor: Actor, calendarId: number, input: ImportInput): { added: number; skipped: number } {
  requireAdmin(actor)
  const cal = getCalendar(calendarId)
  if (!isPresetKey(input.preset)) throw new Validation("Unknown preset", { fields: { preset: "invalid" } })
  if (!Number.isInteger(input.year) || input.year < 1990 || input.year > 2100)
    throw new Validation("Invalid year", { fields: { year: "invalid" } })
  const presetDays = checkPresetDays(input.preset, input.presetDays, input.year)
  if (input.replace) {
    const rows = calendarYear(actor, cal.id, input.year)
    for (const h of rows) ensureHolidayChangeAllowed(h.date)
    for (const h of rows) removeHoliday({ actor }, h)
  }
  const result = insertMissing(cal.id, presetHolidays(input.preset, input.year, presetDays), { actor })
  if (!isPresetKey(cal.regionCode))
    db.update(holidayCalendars)
      .set({ regionCode: input.preset, presetDays })
      .where(eq(holidayCalendars.id, cal.id))
      .run()
  return result
}

/** Federal (1 August), cantonal (from the calendar's preset) or a company day (anything else in a preset calendar). */
export function holidayKinds(cal: Pick<HolidayCalendar, "regionCode" | "presetDays">, rows: Pick<Holiday, "date">[]) {
  const years = [...new Set(rows.map((h) => Number(h.date.slice(0, 4))))]
  const preset = isPresetKey(cal.regionCode)
    ? new Set(years.flatMap((y) => presetHolidays(cal.regionCode, y, cal.presetDays).map((h) => h.date)))
    : null
  return (date: string): HolidayKind | null => {
    if (date.slice(5) === FEDERAL_DAY) return "federal"
    if (!preset) return null
    return preset.has(date) ? "cantonal" : "company"
  }
}

export function calendarYearWithKinds(actor: Actor, calendarId: number, year: number) {
  const rows = calendarYear(actor, calendarId, year)
  const kind = holidayKinds(getCalendar(calendarId), rows)
  return rows.map((h) => ({
    id: h.id,
    calendarId: h.calendarId,
    date: h.date,
    name: h.name,
    fraction: h.fraction,
    kind: kind(h.date),
  }))
}

// ------------------------------------------------------------------ optional company days

/** Easter Sunday (Gregorian, anonymous algorithm). */
function easter(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return Temporal.PlainDate.from({ year, month, day }).toString()
}

function nthWeekday(year: number, month: number, isoWeekday: number, n: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year, month, day: 1 })
  return first.add({ days: ((isoWeekday - first.dayOfWeek + 7) % 7) + 7 * (n - 1) })
}

/** Zurich: third Monday in April, a week later on Easter Monday, a week earlier in Holy Week. */
export function sechselaeuten(year: number): string {
  const day = nthWeekday(year, 4, 1, 3)
  const easterMonday = Temporal.PlainDate.from(easter(year)).add({ days: 1 })
  const diff = day.until(easterMonday).days
  if (diff === 0) return day.add({ days: 7 }).toString()
  if (diff === 7) return day.subtract({ days: 7 }).toString()
  return day.toString()
}

/** Zurich: the Monday after the second Sunday in September. */
export function knabenschiessen(year: number): string {
  return nthWeekday(year, 9, 7, 2).add({ days: 1 }).toString()
}

const COMPANY_DAYS: {
  key: CompanyDayKey
  name: string
  fraction: number
  date: (year: number) => string
  presets?: readonly string[]
}[] = [
  { key: "dec24_pm", name: "Christmas Eve", fraction: 0.5, date: (y) => `${y}-12-24` },
  { key: "dec31_pm", name: "New Year's Eve", fraction: 0.5, date: (y) => `${y}-12-31` },
  { key: "berchtold", name: "Berchtold's Day", fraction: 1, date: (y) => `${y}-01-02` },
  { key: "sechselaeuten_pm", name: "Sechseläuten", fraction: 0.5, date: sechselaeuten, presets: ["CH-ZH"] },
  { key: "knabenschiessen_pm", name: "Knabenschiessen", fraction: 0.5, date: knabenschiessen, presets: ["CH-ZH"] },
]

/** Company days that may be added to a calendar in a year (never added automatically). */
export function companyDayOptions(actor: Actor, calendarId: number, year: number) {
  const rows = calendarYear(actor, calendarId, year)
  const cal = getCalendar(calendarId)
  const taken = new Set(rows.map((h) => h.date))
  // the canton's own days (ticked or not) are chosen in the calendar settings, not here
  const statutory = isPresetKey(cal.regionCode)
    ? new Set([...presetHolidays(cal.regionCode, year, []), ...selectableDays(cal.regionCode, year)].map((h) => h.date))
    : new Set<string>()
  return COMPANY_DAYS.filter((d) => !d.presets || d.presets.includes(cal.regionCode))
    .map((d) => ({ key: d.key, date: d.date(year), name: d.name, fraction: d.fraction }))
    .filter((d) => !statutory.has(d.date))
    .map((d) => Object.assign(d, { added: taken.has(d.date) }))
}

export function addCompanyDay(actor: Actor, calendarId: number, key: CompanyDayKey, year: number): Holiday {
  const day = companyDayOptions(actor, calendarId, year).find((d) => d.key === key)
  if (!day) throw new Validation("Not available for this calendar", { fields: { key: "invalid" } })
  return saveHoliday(actor, calendarId, { date: day.date, name: day.name, fraction: day.fraction })
}

// ------------------------------------------------------------------ yearly top-up (worker)

function activeAdminIds(): number[] {
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
    .all()
    .map((u) => u.id)
}

function alreadyNotified(kind: string, calendarId: number, year: number): boolean {
  return (
    db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, kind),
          sql`json_extract(${notifications.payload}, '$.calendar_id') = ${calendarId}`,
          sql`json_extract(${notifications.payload}, '$.year') = ${year}`,
        ),
      )
      .limit(1)
      .get() != null
  )
}

export interface TopUpResult {
  topped: { calendarId: number; year: number; added: number }[]
  missing: { calendarId: number; year: number }[]
}

/**
 * Adds next year's holidays (and this year's if missing) to every preset calendar. A year counts as present
 * once the calendar holds one of the preset's dates of that year, so deleted holidays are never re-added.
 * Only inserts; dates on or before the latest signed-off period are skipped. From 1 November, calendars
 * without a preset that have nothing for next year are reported to the administrators once.
 */
export function topUpHolidays(
  today: string = localToday(getSetting("default_timezone")),
  source = "worker",
): TopUpResult {
  const year = Number(today.slice(0, 4))
  const result: TopUpResult = { topped: [], missing: [] }
  const admins = activeAdminIds()
  for (const cal of db.select().from(holidayCalendars).orderBy(asc(holidayCalendars.id)).all()) {
    if (isPresetKey(cal.regionCode)) {
      for (const y of [year, year + 1]) {
        const items = presetHolidays(cal.regionCode, y, cal.presetDays)
        const present = items.length
          ? db
              .select({ id: holidays.id })
              .from(holidays)
              .where(
                and(
                  eq(holidays.calendarId, cal.id),
                  inArray(
                    holidays.date,
                    items.map((i) => i.date),
                  ),
                ),
              )
              .limit(1)
              .get()
          : null
        if (present) continue
        const { added } = insertMissing(cal.id, items, { actor: null, source })
        if (!added) continue
        result.topped.push({ calendarId: cal.id, year: y, added })
        for (const id of admins)
          notify(id, "holidays_topped_up", { calendar_id: cal.id, calendar: cal.name, year: y, count: added })
      }
    } else if (today >= `${year}-11-01`) {
      const next = year + 1
      const any = db
        .select({ id: holidays.id })
        .from(holidays)
        .where(
          and(
            eq(holidays.calendarId, cal.id),
            gte(holidays.date, `${next}-01-01`),
            lte(holidays.date, `${next}-12-31`),
          ),
        )
        .limit(1)
        .get()
      if (any || alreadyNotified("holidays_missing", cal.id, next)) continue
      result.missing.push({ calendarId: cal.id, year: next })
      for (const id of admins) notify(id, "holidays_missing", { calendar_id: cal.id, calendar: cal.name, year: next })
    }
  }
  return result
}
