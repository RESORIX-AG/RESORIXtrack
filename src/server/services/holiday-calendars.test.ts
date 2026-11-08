import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { makeAdmin, makeCalendar, makeTeam, makeUser } from "@/test/factories"
import { db } from "../db"
import * as s from "../db/schema"
import { freeze } from "../time"
import {
  addCompanyDay,
  applicableCalendar,
  calendarYear,
  calendarYearWithKinds,
  companyDayOptions,
  createCalendarFromPreset,
  deleteCalendar,
  deleteHoliday,
  importPreset,
  knabenschiessen,
  listCalendars,
  myHolidays,
  saveCalendar,
  saveHoliday,
  sechselaeuten,
  topUpHolidays,
} from "./holiday-calendars"
import { defaultPresetDays, holidayPresets, presetHolidays } from "./holiday-presets"
import { loadActor } from "./permissions"
import { history } from "./revisions"
import { updateSettings } from "./settings"

function signOffThrough(end: string) {
  const u = makeUser()
  db.insert(s.monthSignoffs)
    .values({
      userId: u.id,
      month: end.slice(0, 7),
      periodStartDate: `${end.slice(0, 7)}-01`,
      periodEndDate: end,
      periodStartUtc: "2026-01-01T00:00:00.000000Z",
      periodEndUtc: "2026-02-01T00:00:00.000000Z",
      digest: "d",
      seal: "s",
    })
    .run()
}

describe("holiday calendars", () => {
  it("imports the public holidays of canton Zurich", () => {
    const admin = loadActor(makeAdmin().id)
    const cal = saveCalendar(admin, {
      name: "Zürich",
      regionCode: "",
      presetDays: [],
      description: "",
      isDefault: true,
    })
    expect(importPreset(admin, cal.id, { preset: "CH-ZH", presetDays: [], year: 2026, replace: false })).toEqual({
      added: 9,
      skipped: 0,
    })
    const days = Object.fromEntries(calendarYear(admin, cal.id, 2026).map((h) => [h.date, h.name]))
    expect(days["2026-04-06"]).toBe("Easter Monday")
    expect(days["2026-08-01"]).toBe("Swiss National Day")
    expect(days["2026-12-25"]).toBe("Christmas Day")
    expect(days["2026-09-14"]).toBeUndefined() // Knabenschiessen is not a public holiday
    expect(days["2026-04-05"]).toBeUndefined() // Easter Sunday is a Sunday anyway
    expect(listCalendars(admin)[0]).toMatchObject({ regionCode: "CH-ZH", holidayCount: 9, hasPreset: true })
    const kinds = Object.fromEntries(calendarYearWithKinds(admin, cal.id, 2026).map((h) => [h.date, h.kind]))
    expect(kinds["2026-08-01"]).toBe("federal")
    expect(kinds["2026-04-06"]).toBe("cantonal")
    expect(() => importPreset(admin, cal.id, { preset: "XX", presetDays: [], year: 2026, replace: false })).toThrow(
      /Unknown preset/,
    )
    expect(() => importPreset(admin, cal.id, { preset: "DE-BY", presetDays: [], year: 2026, replace: false })).toThrow(
      /Unknown preset/,
    )
    expect(() =>
      saveCalendar(admin, { name: "X", regionCode: "DE", presetDays: [], description: "", isDefault: false }),
    ).toThrow(/Unknown preset/)
  })

  it("ticks a preset's commune days by default, in the picker and on the server alike", () => {
    const fr = holidayPresets("en", 2026).find((p) => p.key === "CH-FR")!
    const communeDays = fr.selectable.filter((d) => d.kind === "commune").map((d) => d.name)
    expect(communeDays.length).toBeGreaterThan(0)
    expect(fr.defaultDays).toEqual(communeDays)
    expect(defaultPresetDays("CH-FR", 2026)).toEqual(communeDays)
    expect(defaultPresetDays("XX", 2026)).toEqual([])
  })

  it("offers the 26 cantons, split into statutory and selectable days", () => {
    const presets = holidayPresets("en", 2026)
    expect(presets).toHaveLength(26)
    expect(presets.every((p) => /^CH-[A-Z]{2}$/.test(p.key))).toBe(true)
    const fr = presets.find((p) => p.key === "CH-FR")!
    expect(fr.selectable.map((d) => [d.name, d.kind])).toEqual([
      ["Berchtold's Day", "optional"],
      ["Easter Monday", "optional"],
      ["Whit Monday", "optional"],
      ["Corpus Christi", "commune"],
      ["Assumption Day", "commune"],
      ["All Saints' Day", "commune"],
      ["Immaculate Conception", "commune"],
      ["Boxing Day", "optional"],
    ])
    expect(fr.selectable.find((d) => d.name === "Corpus Christi")?.exceptIn).toContain("Murten")
    // Knabenschiessen starts at 13:00: a half day
    expect(presets.find((p) => p.key === "CH-ZH")?.selectable).toContainEqual(
      expect.objectContaining({ name: "Knabenschiessen", date: "2026-09-14", fraction: 0.5, kind: "optional" }),
    )
    // the old City of Fribourg preset: the canton's statutory days plus its commune days
    const commune = ["Corpus Christi", "Assumption Day", "All Saints' Day", "Immaculate Conception"]
    expect(presetHolidays("CH-FR", 2031, commune)).toHaveLength(9)
    expect(presetHolidays("CH-FR", 2031, [])).toHaveLength(5)
    expect(() => presetHolidays("ch-fr-fribourg", 2026, [])).toThrow(/Unknown preset/)
    const cal = createCalendarFromPreset("CH-BE", { years: [2026], makeDefault: true })
    expect(cal.isDefault).toBe(true)
    expect(cal.name).toBe("Canton of Bern")
    expect(createCalendarFromPreset("CH-BE", { years: [2026, 2027] }).id).toBe(cal.id)
    // named in the company language; a calendar under the earlier name is reused
    updateSettings({ default_locale: "de" })
    expect(createCalendarFromPreset("CH-ZH", { years: [2026] }).name).toBe("Kanton Zürich")
    const legacy = db
      .insert(s.holidayCalendars)
      .values({ name: "CH-GE Canton of Geneva", regionCode: "CH-GE" })
      .returning()
      .get()
    expect(createCalendarFromPreset("CH-GE", { years: [2026] }).id).toBe(legacy.id)
    expect(() => createCalendarFromPreset("XX")).toThrow(/Unknown preset/)
    expect(() => createCalendarFromPreset("CH-ZH", { presetDays: ["Boxing Day"] })).toThrow(/Unknown holiday/)
  })

  it("adds ticked days on create and every top-up", () => {
    makeAdmin()
    const lu = createCalendarFromPreset("CH-LU", { years: [2026], presetDays: ["Easter Monday"] })
    expect(lu.presetDays).toEqual(["Easter Monday"])
    const names = (y: number) =>
      db
        .select()
        .from(s.holidays)
        .where(eq(s.holidays.calendarId, lu.id))
        .all()
        .filter((h) => h.date.startsWith(String(y)))
        .map((h) => h.name)
    expect(names(2026)).toContain("Easter Monday")
    expect(names(2026)).not.toContain("Whit Monday")
    topUpHolidays("2026-10-01")
    expect(names(2027)).toContain("Easter Monday")
    expect(names(2027)).not.toContain("Berchtold's Day")
  })

  it("a new calendar with a canton gets its days for this year and next, never in signed-off months", () => {
    freeze("2026-03-15T08:00:00Z")
    const admin = loadActor(makeAdmin().id)
    signOffThrough("2026-01-31")
    const input = { name: "Our office", regionCode: "CH-LU", description: "", isDefault: false }
    const cal = saveCalendar(admin, { ...input, presetDays: ["Easter Monday"] })
    expect(cal.name).toBe("Our office")
    const dates = (y: number) => calendarYear(admin, cal.id, y).map((h) => h.date)
    expect(dates(2026)).not.toContain("2026-01-01") // signed off
    expect(dates(2026)).toContain("2026-04-06") // Easter Monday, ticked
    expect(dates(2027)).toContain("2027-01-01")
    expect(dates(2027)).not.toContain("2027-05-17") // Whit Monday, not ticked
    const easter = calendarYear(admin, cal.id, 2026).find((h) => h.date === "2026-04-06")!
    expect(history("holiday", easter.id)).toMatchObject([{ action: "create", actorId: admin.id }])
    const empty = saveCalendar(admin, { ...input, name: "Empty", regionCode: "", presetDays: [] })
    expect(calendarYear(admin, empty.id, 2026)).toEqual([])
    expect(() => saveCalendar(loadActor(makeUser().id), { ...input, name: "X", presetDays: [] })).toThrow(
      /Administrators only/,
    )
  })

  it("ticking and unticking changes days from today on, never in signed-off months, never edited days", () => {
    freeze("2026-03-15T08:00:00Z")
    const admin = loadActor(makeAdmin().id)
    const lu = createCalendarFromPreset("CH-LU", {
      years: [2026, 2027],
      presetDays: ["Berchtold's Day", "Easter Monday"],
    })
    const input = { name: lu.name, regionCode: "CH-LU", description: "", isDefault: true }
    const has = (date: string) => calendarYear(admin, lu.id, Number(date.slice(0, 4))).some((h) => h.date === date)
    signOffThrough("2026-01-31")
    // 2027 Easter Monday renamed by hand: it stays when unticked
    const em27 = calendarYear(admin, lu.id, 2027).find((h) => h.date === "2027-03-29")!
    saveHoliday(admin, lu.id, { date: em27.date, name: "Company Easter", fraction: 1 }, em27.id)
    saveCalendar(admin, { ...input, presetDays: ["Whit Monday"] }, lu.id)
    expect(has("2026-01-02")).toBe(true) // signed off
    expect(has("2027-01-02")).toBe(false)
    expect(has("2026-04-06")).toBe(false) // Easter Monday, after today
    expect(has("2027-03-29")).toBe(true) // edited by hand
    expect(has("2026-05-25")).toBe(true) // Whit Monday ticked
    expect(has("2027-05-17")).toBe(true)
    freeze("2026-06-01T08:00:00Z")
    saveCalendar(admin, { ...input, presetDays: [] }, lu.id)
    expect(has("2026-05-25")).toBe(true) // in the past
    expect(has("2027-05-17")).toBe(false)
    expect(() => saveCalendar(admin, { ...input, presetDays: ["Saint Joseph"] }, lu.id)).toThrow(/Unknown holiday/)
    expect(() => saveCalendar(loadActor(makeUser().id), { ...input, presetDays: [] }, lu.id)).toThrow(
      /Administrators only/,
    )
  })

  it("records every holiday change in the change log", () => {
    const admin = loadActor(makeAdmin().id)
    const cal = makeCalendar()
    const h = saveHoliday(admin, cal.id, { date: "2027-02-02", name: "Company day", fraction: 1 })
    saveHoliday(admin, cal.id, { date: "2027-02-02", name: "Company day", fraction: 0.5 }, h.id)
    deleteHoliday(admin, h.id)
    expect(history("holiday", h.id).map((r) => [r.action, r.actorId, r.after?.fraction])).toEqual([
      ["create", admin.id, 1],
      ["update", admin.id, 0.5],
      ["delete", admin.id, 0.5],
    ])
    const be = createCalendarFromPreset("CH-BE", { years: [2027], source: "cli" })
    const first = calendarYear(admin, be.id, 2027)[0]
    expect(history("holiday", first.id)).toMatchObject([{ action: "create", actorId: null, source: "cli" }])
    deleteCalendar(admin, be.id)
    expect(history("holiday", first.id).map((r) => r.action)).toEqual(["create", "delete"])
  })

  it("deleting a calendar keeps the earlier terms of exactly the people it applied to", () => {
    freeze("2026-06-15T10:00:00Z")
    const admin = loadActor(makeAdmin({ holidayCalendarId: null }).id)
    const cal = makeCalendar({ name: "Gone" }, [{ date: "2026-12-24", name: "Christmas Eve" }])
    const other = makeCalendar({ name: "Other", isDefault: false })
    const team = makeTeam({ holidayCalendarId: cal.id })
    const otherTeam = makeTeam({ holidayCalendarId: other.id })
    const noCalendarTeam = makeTeam({ holidayCalendarId: null })
    const people = {
      own: makeUser({ holidayCalendarId: cal.id, teamId: otherTeam.id }),
      team: makeUser({ teamId: team.id }),
      teamWithoutCalendar: makeUser({ teamId: noCalendarTeam.id }),
      ownOther: makeUser({ holidayCalendarId: other.id, teamId: team.id }),
      otherTeam: makeUser({ teamId: otherTeam.id }),
    }
    deleteCalendar(admin, cal.id)
    const kept = new Map(
      db
        .select()
        .from(s.userTermsHistory)
        .all()
        .map((r) => [r.userId, r.holidayCalendarId]),
    )
    expect(Object.fromEntries(Object.entries(people).map(([k, u]) => [k, kept.get(u.id) ?? null]))).toEqual({
      own: cal.id,
      team: cal.id,
      teamWithoutCalendar: cal.id,
      ownOther: null,
      otherTeam: null,
    })
  })

  it("keeps a calendar that counted for passed days of someone on it now", () => {
    freeze("2026-06-15T10:00:00Z")
    const admin = loadActor(makeAdmin().id)
    makeCalendar({ name: "Default" })
    const cal = makeCalendar({ name: "Team", isDefault: false }, [{ date: "2026-01-01", name: "New Year's Day" }])
    const team = makeTeam({ holidayCalendarId: cal.id })
    const member = makeUser({ teamId: team.id })
    expect(() => deleteCalendar(admin, cal.id)).toThrow(/counted for days already passed/)
    db.update(s.users)
      .set({ holidayCalendarId: makeCalendar({ isDefault: false }).id })
      .where(eq(s.users.id, member.id))
      .run()
    deleteCalendar(admin, cal.id)
  })

  it("refuses holiday changes inside signed-off months", () => {
    const admin = loadActor(makeAdmin().id)
    const cal = makeCalendar({}, [{ date: "2026-01-01", name: "New Year's Day" }])
    signOffThrough("2026-01-31")
    expect(() => saveHoliday(admin, cal.id, { date: "2026-01-02", name: "Berchtold's Day", fraction: 1 })).toThrow(
      /signed-off/,
    )
    const jan1 = calendarYear(admin, cal.id, 2026)[0]
    expect(() => deleteHoliday(admin, jan1.id)).toThrow(/signed-off/)
    expect(saveHoliday(admin, cal.id, { date: "2026-02-02", name: "Company day", fraction: 0.5 }).fraction).toBe(0.5)
    // the import skips frozen dates instead of failing
    expect(
      importPreset(admin, cal.id, { preset: "CH-ZH", presetDays: [], year: 2026, replace: false }).skipped,
    ).toBeGreaterThan(0)
  })

  it("computes the Zurich customs", () => {
    expect(sechselaeuten(2026)).toBe("2026-04-20")
    expect(sechselaeuten(2025)).toBe("2025-04-28") // third Monday is Easter Monday
    expect(sechselaeuten(2019)).toBe("2019-04-08") // third Monday is in Holy Week
    expect(knabenschiessen(2026)).toBe("2026-09-14")
    expect(knabenschiessen(2024)).toBe("2024-09-09")
  })

  it("adds optional company days on request only", () => {
    const admin = loadActor(makeAdmin().id)
    const zh = createCalendarFromPreset("CH-ZH", { years: [2026] })
    const keys = companyDayOptions(admin, zh.id, 2026).map((d) => d.key)
    // Berchtold's Day and Knabenschiessen are Zurich's optional days, ticked in the calendar settings
    expect(keys).toEqual(["dec24_pm", "dec31_pm", "sechselaeuten_pm"])
    expect(addCompanyDay(admin, zh.id, "dec24_pm", 2026)).toMatchObject({ date: "2026-12-24", fraction: 0.5 })
    expect(companyDayOptions(admin, zh.id, 2026).find((d) => d.key === "dec24_pm")?.added).toBe(true)
    expect(() => addCompanyDay(admin, zh.id, "dec24_pm", 2026)).toThrow(/already a holiday/)
    expect(calendarYearWithKinds(admin, zh.id, 2026).find((h) => h.date === "2026-12-24")?.kind).toBe("company")
    // Berchtoldstag is cantonal in Bern, so it is not offered there; Zurich customs only in Zurich
    const be = createCalendarFromPreset("CH-BE", { years: [2026] })
    expect(companyDayOptions(admin, be.id, 2026).map((d) => d.key)).toEqual(["dec24_pm", "dec31_pm"])
    expect(() => addCompanyDay(admin, be.id, "sechselaeuten_pm", 2026)).toThrow(/Not available/)
    expect(() => companyDayOptions(loadActor(makeUser().id), zh.id, 2026)).toThrow(/Administrators only/)
  })

  it("is for administrators only", () => {
    const emp = loadActor(makeUser().id)
    expect(() => listCalendars(emp)).toThrow(/Administrators only/)
    expect(() =>
      saveCalendar(emp, { name: "X", regionCode: "", presetDays: [], description: "", isDefault: false }),
    ).toThrow(/Administrators only/)
  })
})

const notes = (kind: string) => db.select().from(s.notifications).where(eq(s.notifications.kind, kind)).all()

describe("holiday top-up", () => {
  it("adds next year's holidays once, idempotently, and notifies administrators", () => {
    const admin = makeAdmin()
    const cal = createCalendarFromPreset("CH-ZH", { years: [2026] })
    const first = topUpHolidays("2026-10-01")
    expect(first.topped).toEqual([{ calendarId: cal.id, year: 2027, added: 9 }])
    expect(notes("holidays_topped_up")).toMatchObject([
      { userId: admin.id, payload: { calendar_id: cal.id, calendar: cal.name, year: 2027, count: 9 } },
    ])
    expect(topUpHolidays("2026-10-02").topped).toEqual([])
    expect(notes("holidays_topped_up")).toHaveLength(1)
    // a deleted holiday stays deleted; nothing is updated or re-added
    const adm = loadActor(admin.id)
    deleteHoliday(adm, calendarYear(adm, cal.id, 2027)[0].id)
    expect(topUpHolidays("2026-10-03").topped).toEqual([])
    expect(calendarYear(adm, cal.id, 2027)).toHaveLength(8)
  })

  it("fills a missing current year but never dates inside signed-off periods", () => {
    makeAdmin()
    const cal = makeCalendar({ regionCode: "CH-BE" })
    signOffThrough("2026-05-31")
    const r = topUpHolidays("2026-07-01")
    expect(r.topped.map((t) => t.year)).toEqual([2026, 2027])
    const dates = db
      .select()
      .from(s.holidays)
      .where(eq(s.holidays.calendarId, cal.id))
      .all()
      .map((h) => h.date)
    expect(dates.filter((d) => d <= "2026-05-31")).toEqual([])
    expect(dates).toContain("2026-08-01")
  })

  it("warns once from 1 November about calendars without a preset", () => {
    makeAdmin()
    const manual = makeCalendar({}, [{ date: "2026-12-25", name: "Christmas Day" }])
    expect(topUpHolidays("2026-10-15").missing).toEqual([])
    expect(topUpHolidays("2026-11-01").missing).toEqual([{ calendarId: manual.id, year: 2027 }])
    expect(topUpHolidays("2026-11-02").missing).toEqual([])
    expect(notes("holidays_missing")).toHaveLength(1)
    db.insert(s.holidays).values({ calendarId: manual.id, date: "2027-01-01", name: "New Year's Day" }).run()
    expect(topUpHolidays("2027-11-01").missing).toEqual([{ calendarId: manual.id, year: 2028 }])
  })
})

describe("the calendar that applies to a person", () => {
  it("resolves personal, then team, then company default, else none", () => {
    expect(applicableCalendar(makeUser())).toBeNull()
    const def = makeCalendar({ isDefault: true })
    const teamCal = makeCalendar({ isDefault: false })
    const own = makeCalendar({ isDefault: false })
    const team = makeTeam({ name: "RF Engineering", holidayCalendarId: teamCal.id })
    const bare = makeTeam({ holidayCalendarId: null })
    expect(applicableCalendar(makeUser())).toMatchObject({ source: "default", calendar: { id: def.id }, team: null })
    expect(applicableCalendar(makeUser({ teamId: bare.id }))).toMatchObject({
      source: "default",
      calendar: { id: def.id },
    })
    expect(applicableCalendar(makeUser({ teamId: team.id }))).toMatchObject({
      source: "team",
      calendar: { id: teamCal.id },
      team: { id: team.id, name: "RF Engineering" },
    })
    expect(applicableCalendar(makeUser({ teamId: team.id, holidayCalendarId: own.id }))).toMatchObject({
      source: "user",
      calendar: { id: own.id },
      team: null,
    })
  })

  it("myHolidays: one year for every role, the calendar's years plus this and next, null without a calendar", () => {
    freeze("2026-11-05T08:00:00Z")
    const nobody = loadActor(makeUser().id)
    expect(myHolidays(nobody)).toBeNull()
    const cal = makeCalendar({ isDefault: true, name: "Fribourg" }, [
      { date: "2024-12-25", name: "Christmas Day" },
      { date: "2026-08-01", name: "Swiss National Day" },
      { date: "2026-12-24", name: "Christmas Eve", fraction: 0.5 },
    ])
    const employee = loadActor(makeUser().id)
    const mine = myHolidays(employee)
    expect(mine).toMatchObject({
      source: "default",
      team: null,
      year: 2026,
      years: [2024, 2026, 2027],
      calendar: { id: cal.id, name: "Fribourg", isDefault: true },
    })
    expect(mine?.holidays.map((h) => [h.date, h.name, h.fraction])).toEqual([
      ["2026-08-01", "Swiss National Day", 1],
      ["2026-12-24", "Christmas Eve", 0.5],
    ])
    expect(myHolidays(employee, 2024)).toMatchObject({ year: 2024, years: [2024, 2026, 2027] })
    expect(myHolidays(employee, 2024)?.holidays.map((h) => h.name)).toEqual(["Christmas Day"])
    // a year outside the calendar is shown too, empty, and gets its tab
    expect(myHolidays(employee, 2030)).toMatchObject({ year: 2030, years: [2024, 2026, 2027, 2030], holidays: [] })
    expect(myHolidays(loadActor(makeAdmin().id))?.calendar.id).toBe(cal.id)
  })
})
