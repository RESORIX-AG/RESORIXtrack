import { eq } from "drizzle-orm"
/**
 * Test data builders. Keep them minimal and explicit; every test states the data it relies on.
 *
 *   const team = makeTeam()
 *   const lead = makeUser({ name: "Lea Lead" }); makeLead(team.id, lead.id)
 *   const emp = makeUser({ teamId: team.id }); makeSchedule(emp.id, { validFrom: "2026-01-01" })
 *   const actor = loadActor(emp.id)
 */
import type { Json } from "@/lib/json"
import { db } from "@/server/db"
import * as s from "@/server/db/schema"
import { ensureDefaultAbsenceTypes } from "@/server/services/absence-types"
import { loadActor } from "@/server/services/permissions"
import { type SettingKey, settingsSchema, updateSettings, VERSIONED_SETTINGS } from "@/server/services/settings"
import { freeze } from "@/server/time"

let seq = 0

export function makeUser(over: Partial<typeof s.users.$inferInsert> = {}): s.User {
  seq++
  return db
    .insert(s.users)
    .values({ email: `user${seq}@example.nomail`, name: `User ${seq}`, employmentStart: "2025-01-01", ...over })
    .returning()
    .get()
}

export function makeAdmin(over: Partial<typeof s.users.$inferInsert> = {}): s.User {
  return makeUser({ role: "admin", ...over })
}

export function makeTeam(over: Partial<typeof s.teams.$inferInsert> = {}): s.Team {
  seq++
  return db
    .insert(s.teams)
    .values({ name: `Team ${seq}`, ...over })
    .returning()
    .get()
}

export function makeLead(
  teamId: number,
  userId: number,
  over: Partial<typeof s.teamLeads.$inferInsert> = {},
): s.TeamLead {
  return db
    .insert(s.teamLeads)
    .values({ teamId, userId, role: "lead", ...over })
    .returning()
    .get()
}

/** Full-time 42 h Mon–Fri (8:24 per day) unless overridden. */
export function makeSchedule(userId: number, over: Partial<typeof s.workSchedules.$inferInsert> = {}): s.WorkSchedule {
  return db
    .insert(s.workSchedules)
    .values({
      userId,
      validFrom: "2025-01-01",
      pensumPercent: 100,
      minutesMon: 504,
      minutesTue: 504,
      minutesWed: 504,
      minutesThu: 504,
      minutesFri: 504,
      ...over,
    })
    .returning()
    .get()
}

export function makeEntry(
  userId: number,
  startAt: string,
  endAt: string | null,
  over: Partial<typeof s.timeEntries.$inferInsert> = {},
): s.TimeEntry {
  return db
    .insert(s.timeEntries)
    .values({ userId, startAt, endAt, source: "manual", ...over })
    .returning()
    .get()
}

export function makeAbsenceType(over: Partial<typeof s.absenceTypes.$inferInsert> = {}): s.AbsenceType {
  seq++
  return db
    .insert(s.absenceTypes)
    .values({ key: `type${seq}`, label: `Type ${seq}`, ...over })
    .returning()
    .get()
}

export function makeCalendar(
  over: Partial<typeof s.holidayCalendars.$inferInsert> = {},
  days: { date: string; name: string; fraction?: number }[] = [],
): s.HolidayCalendar {
  seq++
  const cal = db
    .insert(s.holidayCalendars)
    .values({ name: `Calendar ${seq}`, isDefault: true, ...over })
    .returning()
    .get()
  for (const d of days)
    db.insert(s.holidays)
      .values({ calendarId: cal.id, ...d })
      .run()
  return cal
}

const versioned = (key: string) => (VERSIONED_SETTINGS as readonly string[]).includes(key)

/** Company settings as if they always applied (figure-changing ones too: base value, no dated version). */
export function withSettings(values: Parameters<typeof updateSettings>[0], opts: { validFrom?: string } = {}) {
  if (opts.validFrom) {
    updateSettings(values, opts)
    return
  }
  updateSettings(Object.fromEntries(Object.entries(values).filter(([key]) => !versioned(key))))
  for (const [key, value] of Object.entries(values)) {
    if (!versioned(key)) continue
    if (!settingsSchema.shape[key as SettingKey].safeParse(value).success) throw new Error(`invalid ${key}`)
    db.delete(s.settingVersions).where(eq(s.settingVersions.key, key)).run()
    db.insert(s.settings)
      .values({ key, value: value as Json })
      .onConflictDoUpdate({ target: s.settings.key, set: { value: value as Json } })
      .run()
  }
}

export { loadActor }

/** Active sign-off of `month` (YYYY-MM) for a person in Europe/Zurich (raw row; seals are not computed). */
export function lockMonth(
  userId: number,
  month: string,
  over: Partial<typeof s.monthSignoffs.$inferInsert> = {},
  tz = "Europe/Zurich",
): s.MonthSignoff {
  const [y, m] = month.split("-").map(Number)
  const start = Temporal.PlainDate.from({ year: y, month: m, day: 1 })
  const end = start.add({ months: 1 })
  const utc = (d: Temporal.PlainDate) =>
    d.toZonedDateTime({ timeZone: tz }).toInstant().toString({ smallestUnit: "microsecond" })
  return db
    .insert(s.monthSignoffs)
    .values({
      userId,
      month,
      periodStartDate: start.toString(),
      periodEndDate: end.subtract({ days: 1 }).toString(),
      periodStartUtc: utc(start),
      periodEndUtc: utc(end),
      digest: "test",
      seal: "test",
      ...over,
    })
    .returning()
    .get()
}

/** Absence row written directly (no business rules), approved unless overridden. */
export function makeAbsenceRow(
  userId: number,
  typeId: number,
  startDate: string,
  endDate = startDate,
  over: Partial<typeof s.absences.$inferInsert> = {},
): s.Absence {
  return db
    .insert(s.absences)
    .values({ userId, typeId, startDate, endDate, status: "approved", ...over })
    .returning()
    .get()
}

/** A person with a full-time schedule and an address derived from the first name. */
function orgPerson(name: string, over: Partial<typeof s.users.$inferInsert> = {}) {
  const u = makeUser({ name, email: `${name.split(" ")[0].toLowerCase()}@example.nomail`, ...over })
  makeSchedule(u.id)
  return u
}

/**
 * A small company like v1's test org: team A (lead Lea, Anna, Ben), team B (Carl, no lead), an administrator
 * without HR and an HR person (pass `hr: false` to leave HR out). Everyone works 42 h Mon-Fri; a default holiday
 * calendar has Christmas and 8 December 2026. Default absence types are installed. Clock: Thu 2026-11-05 09:00.
 */
export function makeOrg(opts: { hr?: boolean } = {}) {
  freeze("2026-11-05T08:00:00Z")
  makeCalendar({}, [
    { date: "2026-12-08", name: "Immaculate Conception" },
    { date: "2026-12-25", name: "Christmas" },
  ])
  ensureDefaultAbsenceTypes()
  const teamA = makeTeam({ name: "Team A" })
  const teamB = makeTeam({ name: "Team B" })
  const lead = orgPerson("Lea Lead", { teamId: teamA.id })
  makeLead(teamA.id, lead.id)
  const anna = orgPerson("Anna Muster", { teamId: teamA.id })
  const ben = orgPerson("Ben Beispiel", { teamId: teamA.id })
  const carl = orgPerson("Carl Other", { teamId: teamB.id })
  const admin = orgPerson("Ada Admin", { role: "admin" })
  const hr = opts.hr === false ? null : orgPerson("Hanna HR", { capabilities: ["hr"] })
  return { teamA, teamB, lead, anna, ben, carl, admin, hr }
}
