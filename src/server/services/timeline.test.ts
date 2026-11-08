import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { db, rawSqlite } from "@/server/db"
import * as s from "@/server/db/schema"
import type { AppError } from "@/server/errors"
import { freeze } from "@/server/time"
import {
  loadActor,
  lockMonth,
  makeAdmin,
  makeCalendar,
  makeEntry,
  makeSchedule,
  makeTeam,
  makeUser,
} from "@/test/factories"
import { computeDays, vacationAccount } from "./accounts"
import { deleteCalendar, setDefaultCalendar } from "./holiday-calendars"
import { holidaysFor } from "./holidays"
import { deleteSchedule, schedulesOf } from "./schedules"
import { getAllSettings, getSetting, settingsTimeline, updateSettings } from "./settings"
import { setMembers, updateTeam } from "./teams"
import { dayOfMs, personTimeline } from "./timeline"
import { rehire, updateUser } from "./users"

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected an error")
}

const fresh = (id: number) => db.select().from(s.users).where(eq(s.users.id, id)).get()!
const admin = () => loadActor(makeAdmin().id)

beforeEach(() => freeze("2026-11-20T10:00:00Z"))

describe("dated company settings", () => {
  it("change from a day on; earlier days keep the old value; never on a signed-off day", () => {
    // no time data yet (setup): the value simply changes
    updateSettings({ holiday_mode: "prorata" })
    expect(settingsTimeline().changes).toEqual([])
    updateSettings({ holiday_mode: "scheduled" })

    const u = makeUser({ employmentStart: "2026-01-01" })
    makeSchedule(u.id, { validFrom: "2026-01-01" })
    makeEntry(u.id, "2026-10-05T07:00:00.000000Z", "2026-10-05T15:00:00.000000Z")
    updateSettings({ night_work_permitted: true })
    const t = settingsTimeline()
    expect(t.at("2026-11-19").night_work_permitted).toBe(false)
    expect(t.at("2026-11-20").night_work_permitted).toBe(true)
    expect(getSetting("night_work_permitted")).toBe(true)
    // saving a whole form with unchanged values adds nothing
    updateSettings({ ...getAllSettings() })
    expect(settingsTimeline().changes).toEqual(["2026-11-20"])

    lockMonth(u.id, "2026-10")
    expect(err(() => updateSettings({ compliance_enabled: false }, { validFrom: "2026-10-31" })).code).toBe(
      "period_signed_off",
    )
    expect(updateSettings({ compliance_enabled: false }, { validFrom: "2026-11-01" }).compliance_enabled).toBe(false)
    expect(() =>
      rawSqlite()
        .prepare("INSERT INTO setting_versions (key, valid_from, value) VALUES ('holiday_mode', '2026-10-15', ?)")
        .run('"prorata"'),
    ).toThrow(/period signed off/)
    expect(() => rawSqlite().prepare("UPDATE settings SET value = 'true' WHERE key = 'holiday_mode'").run()).toThrow(
      /period signed off/,
    )
  })
})

describe("dated terms", () => {
  it("a new timezone applies from its day on and never moves earlier work", () => {
    const u = makeUser({ employmentStart: "2026-01-01" })
    makeSchedule(u.id, { validFrom: "2026-01-01" })
    // 22:00-23:00 in Zurich on 31 October; 22:00-23:00 in New York on 1 November
    makeEntry(u.id, "2026-10-31T21:00:00.000000Z", "2026-10-31T22:00:00.000000Z")
    makeEntry(u.id, "2026-11-02T03:00:00.000000Z", "2026-11-02T04:00:00.000000Z")
    const before = computeDays(u, "2026-10-31", "2026-11-02").map((d) => [d.date, d.workedMin])
    expect(before).toEqual([
      ["2026-10-31", 60],
      ["2026-11-01", 0],
      ["2026-11-02", 60],
    ])
    updateUser(admin(), u.id, { timezone: "America/New_York", termsFrom: "2026-11-01" })
    const moved = fresh(u.id)
    expect(computeDays(moved, "2026-10-31", "2026-11-02").map((d) => [d.date, d.workedMin])).toEqual([
      ["2026-10-31", 60],
      ["2026-11-01", 60],
      ["2026-11-02", 0],
    ])
    const tl = personTimeline(moved)
    expect(tl.termsOn("2026-10-31").timezone).toBe("Europe/Zurich")
    expect(tl.termsOn("2026-11-01").timezone).toBe("America/New_York")
    // the first day in New York begins when the last day in Zurich ended
    expect(dayOfMs(Date.parse("2026-10-31T23:30:00Z"), tl.tzOn)).toBe("2026-11-01")
    // a later change cannot reach back before the current terms
    expect(err(() => updateUser(admin(), u.id, { recordingMode: "simplified", termsFrom: "2026-10-20" })).code).toBe(
      "terms_order",
    )
  })

  it("terms never change on a signed-off day (service and database)", () => {
    const u = makeUser({ employmentStart: "2026-01-01", vacationDaysPerYear: 25 })
    makeSchedule(u.id, { validFrom: "2026-01-01" })
    lockMonth(u.id, "2026-10")
    expect(err(() => updateUser(admin(), u.id, { regularNightWork: true, termsFrom: "2026-10-15" })).code).toBe(
      "period_signed_off",
    )
    expect(err(() => updateUser(admin(), u.id, { regularNightWork: true, termsFrom: "2026-12-01" })).fields).toEqual({
      termsFrom: "future",
    })
    expect(updateUser(admin(), u.id, { vacationDaysPerYear: 30, termsFrom: "2026-11-01" }).vacationDaysPerYear).toBe(30)
    // 25 for ten months, 30 for two: 25.83, rounded up
    expect(vacationAccount(fresh(u.id), 2026).entitlement).toBe(26)
    expect(() =>
      rawSqlite().prepare("UPDATE users SET legal_weekly_max_hours = 50 WHERE id = ?").run(u.id),
    ).not.toThrow()
    expect(() => rawSqlite().prepare("DELETE FROM user_terms_history WHERE user_id = ?").run(u.id)).toThrow(
      /period signed off/,
    )
    expect(() => rawSqlite().prepare("UPDATE user_terms_history SET timezone = 'UTC'").run()).toThrow(/fixed/)
  })
})

describe("team and holiday calendar", () => {
  it("changes from today on; earlier days keep their calendar (person, team, company default)", () => {
    const a = makeCalendar({ name: "A" }, [
      { date: "2026-08-01", name: "National Day" },
      { date: "2026-12-25", name: "Christmas" },
    ])
    const b = makeCalendar({ name: "B", isDefault: false }, [{ date: "2026-12-26", name: "St Stephen" }])
    const team = makeTeam({ holidayCalendarId: null })
    const u = makeUser({ employmentStart: "2026-01-01", teamId: team.id })
    makeSchedule(u.id, { validFrom: "2026-01-01" })
    const days = () => [...holidaysFor(fresh(u.id), "2026-01-01", "2026-12-31").keys()].sort()
    expect(days()).toEqual(["2026-08-01", "2026-12-25"])
    // the team gets calendar B
    const ad = admin()
    updateTeam(ad, team.id, { holidayCalendarId: b.id })
    expect(days()).toEqual(["2026-08-01", "2026-12-26"])
    // leaving the team the next day, back to the company default
    freeze("2026-11-21T10:00:00Z")
    setMembers(ad, team.id, [])
    expect(days()).toEqual(["2026-08-01", "2026-12-25"])
    // a new company default
    freeze("2026-11-22T10:00:00Z")
    setDefaultCalendar(ad, b.id)
    expect(days()).toEqual(["2026-08-01", "2026-12-26"])
    // A counted for earlier days: it stays
    expect(err(() => deleteCalendar(ad, a.id)).code).toBe("calendar_in_use")
  })
})

describe("employment periods", () => {
  it("rehiring keeps the earlier period; the gap has no target", () => {
    const u = makeUser({ employmentStart: "2025-01-01", employmentEnd: "2025-06-30" })
    makeSchedule(u.id, { validFrom: "2025-01-01" })
    lockMonth(u.id, "2025-06")
    expect(err(() => rehire(admin(), u.id, "2025-06-30")).fields).toEqual({ employmentStart: "before_end" })
    rehire(admin(), u.id, "2026-01-01")
    const back = fresh(u.id)
    expect([back.employmentStart, back.employmentEnd, back.isActive]).toEqual(["2026-01-01", null, true])
    const tl = personTimeline(back)
    expect(["2025-03-01", "2025-09-01", "2026-03-01"].map(tl.employedOn)).toEqual([true, false, true])
    expect(computeDays(back, "2025-09-01", "2025-09-01")[0].targetMin).toBe(0)
    expect(vacationAccount(back, 2025).entitlement).toBe(12.5)
    // the new period cannot start inside the earlier one
    expect(err(() => updateUser(admin(), u.id, { employmentStart: "2025-05-01" })).fields).toEqual({
      employmentStart: "overlaps_earlier",
    })
    expect(() => rawSqlite().prepare("DELETE FROM employment_history WHERE user_id = ?").run(u.id)).toThrow(
      /period signed off/,
    )
  })

  it("rehiring works without a recorded employment start, also after a signed-off month", () => {
    const u = makeUser({ employmentStart: null, employmentEnd: "2025-06-30" })
    makeSchedule(u.id, { validFrom: "2025-01-01" })
    lockMonth(u.id, "2025-06")
    rehire(admin(), u.id, "2026-01-01")
    const [earlier] = db.select().from(s.employmentHistory).where(eq(s.employmentHistory.userId, u.id)).all()
    expect([earlier.startDate, earlier.endDate]).toEqual(["2025-01-01", "2025-06-30"])
    // the guard still refuses an archived period that leaves out a signed-off month
    const v = makeUser({ employmentStart: null, employmentEnd: "2025-06-30" })
    lockMonth(v.id, "2025-03")
    lockMonth(v.id, "2025-06")
    expect(() =>
      rawSqlite()
        .prepare(
          "INSERT INTO employment_history (user_id, start_date, end_date) VALUES (?, '2025-05-01', '2025-06-30')",
        )
        .run(v.id),
    ).toThrow(/period signed off/)
  })

  it("an earlier employment start gets the first schedule, so no day lacks a target", () => {
    const u = makeUser({ employmentStart: "2026-03-01" })
    makeSchedule(u.id, { validFrom: "2026-03-01" })
    updateUser(admin(), u.id, { employmentStart: "2026-02-01" })
    expect(computeDays(fresh(u.id), "2026-02-02", "2026-02-02")[0].targetMin).toBeGreaterThan(0)
    // deleting or moving the first version would open such days again
    const hr = loadActor(makeUser({ capabilities: ["hr"] }).id)
    makeSchedule(u.id, { validFrom: "2026-06-01" })
    const [first] = schedulesOf(u.id)
    expect(err(() => deleteSchedule(hr, first.id, "x")).code).toBe("schedule_gap")
  })
})
