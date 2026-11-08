import { beforeEach, describe, expect, it } from "vitest"
import { db } from "@/server/db"
import * as s from "@/server/db/schema"
import type { AppError } from "@/server/errors"
import { loadActor, makeEntry, makeOrg } from "@/test/factories"
import { createAbsence } from "./absences"
import { absencesReport, balances, projectHours, rawEntries, timesheet } from "./reports"
import { signOffMany } from "./signoffs"

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected an error")
}

let org: ReturnType<typeof makeOrg>
beforeEach(() => {
  org = makeOrg()
  makeEntry(org.anna.id, "2026-10-14T06:00:00.000000Z", "2026-10-14T10:00:00.000000Z", { note: "Kunde" })
  makeEntry(org.anna.id, "2026-10-15T06:00:00.000000Z", "2026-10-15T07:00:00.000000Z", {
    isDeleted: true,
    source: "clock",
  })
  makeEntry(org.carl.id, "2026-10-14T06:00:00.000000Z", "2026-10-14T08:00:00.000000Z")
})

describe("reports", () => {
  it("timesheet with local times, totals and sign-off", () => {
    signOffMany(loadActor(org.lead.id), { month: "2026-10", userIds: [org.anna.id] })
    const ts = timesheet(loadActor(org.anna.id), { year: 2026, month: 10 })
    expect(ts.user).toMatchObject({ name: "Anna Muster", team: "Team A", timezone: "Europe/Zurich" })
    expect(ts.days).toHaveLength(31)
    expect(ts.entries["2026-10-14"]).toEqual([
      { id: expect.any(Number), kind: "work", start: "08:00", end: "12:00", edited: true, note: "Kunde" },
    ])
    expect(ts.entries["2026-10-15"]).toBeUndefined()
    expect(ts.summary.workedMin).toBe(240)
    expect(ts.signoff?.signedBy).toBe("Lea Lead")
    expect(ts.signoff?.seal).toHaveLength(16)
    expect(timesheet(loadActor(org.lead.id), { userId: org.anna.id, year: 2026, month: 10 }).user.id).toBe(org.anna.id)
    expect(err(() => timesheet(loadActor(org.ben.id), { userId: org.anna.id, year: 2026, month: 10 })).code).toBe(
      "not_found",
    )
    expect(err(() => timesheet(loadActor(org.admin.id), { userId: org.anna.id, year: 2026, month: 10 })).code).toBe(
      "not_found",
    )
  })

  it("timesheet of the current month: today is in progress, a past month is unchanged", () => {
    // makeOrg freezes Thu 2026-11-05 09:00 Zurich; 2:00 worked so far today, Mon 8:24
    makeEntry(org.anna.id, "2026-11-02T07:00:00.000000Z", "2026-11-02T15:24:00.000000Z")
    makeEntry(org.anna.id, "2026-11-05T06:00:00.000000Z", "2026-11-05T08:00:00.000000Z")
    const anna = loadActor(org.anna.id)
    const nov = timesheet(anna, { year: 2026, month: 11 })
    expect(nov.days.find((d) => d.isToday)?.date).toBe("2026-11-05")
    // Mon-Wed complete (3 workdays), Thu in progress
    expect(nov.summary).toMatchObject({
      targetMin: 3 * 504,
      workedCompleteMin: 504,
      deltaMin: 504 - 3 * 504,
      todayWorkedMin: 120,
      todayTargetMin: 504,
      workedMin: 504 + 120,
    })
    expect(nov.balanceAfterMin - nov.balanceBeforeMin).toBe(nov.summary.deltaMin)
    const row = balances(loadActor(org.lead.id), { year: 2026, month: 11 }).rows.find((r) => r.userId === org.anna.id)
    expect(row).toMatchObject({ workedMin: 504, targetMin: 3 * 504, deltaMin: 504 - 3 * 504 })

    const oct = timesheet(anna, { year: 2026, month: 10 })
    expect(oct.days.some((d) => d.isToday)).toBe(false)
    expect(oct.summary.workedCompleteMin).toBe(oct.summary.workedMin)
    expect(oct.summary.todayWorkedMin).toBe(0)
    expect(oct.balanceAfterMin - oct.balanceBeforeMin).toBe(oct.summary.deltaMin)
  })

  it("balances in scope", () => {
    const lead = balances(loadActor(org.lead.id), { year: 2026, month: 10 })
    expect(lead.rows.map((r) => r.name).sort()).toEqual(["Anna Muster", "Ben Beispiel", "Lea Lead"])
    expect(lead.rows.find((r) => r.userId === org.anna.id)?.workedMin).toBe(240)
    expect(balances(loadActor(org.anna.id), { year: 2026 }).rows.map((r) => r.userId)).toEqual([org.anna.id])
    expect(balances(loadActor(org.admin.id), { year: 2026 }).rows.map((r) => r.userId)).toEqual([org.admin.id])
    expect(balances(loadActor(org.hr!.id), { year: 2026 }).rows).toHaveLength(6)
  })

  it("absences clipped to the period, summed per type", () => {
    createAbsence(loadActor(org.lead.id), {
      userId: org.anna.id,
      type: "vacation",
      startDate: "2026-11-26",
      endDate: "2026-12-02",
      endHalf: "am",
    })
    createAbsence(loadActor(org.anna.id), { type: "vacation", startDate: "2026-11-24" })
    const r = absencesReport(loadActor(org.lead.id), { from: "2026-11-01", to: "2026-11-30" })
    expect(r.rows.map((x) => `${x.status}:${x.days}`)).toEqual(["pending:1", "approved:3"])
    expect(r.summary.find((x) => x.userId === org.anna.id)).toMatchObject({ byType: { vacation: 3 }, total: 3 })
    const dec = absencesReport(loadActor(org.lead.id), { from: "2026-12-01", to: "2026-12-31", userId: org.anna.id })
    expect(dec.rows[0].days).toBe(1.5)
    expect(absencesReport(loadActor(org.ben.id), { from: "2026-11-01", to: "2026-11-30" }).rows).toEqual([])
    expect(err(() => absencesReport(loadActor(org.ben.id), { from: "2026-11-01", to: "2029-11-30" })).fields).toEqual({
      to: "too_long",
    })
  })

  it("project hours by project and person", () => {
    const p = db.insert(s.projects).values({ name: "Website", code: "WEB" }).returning().get()
    const on = (userId: number, from: string, to: string, over = {}) =>
      makeEntry(userId, `2026-10-14T${from}:00.000000Z`, `2026-10-14T${to}:00.000000Z`, { projectId: p.id, ...over })
    on(org.anna.id, "06:00", "08:00")
    on(org.anna.id, "09:00", "10:00", { projectId: null })
    on(org.ben.id, "06:00", "06:30")
    on(org.ben.id, "07:00", "23:00", { isDeleted: true })
    on(org.carl.id, "06:00", "06:45")
    const r = projectHours(loadActor(org.lead.id), { from: "2026-10-01", to: "2026-10-31" })
    expect(r.projects.map((x) => `${x.kind}:${x.name}:${x.minutes}`)).toEqual(["project:Website:150"])
    expect(r.projects[0].people.map((x) => x.minutes)).toEqual([120, 30])
    expect(r.totalMin).toBe(150)
    expect(projectHours(loadActor(org.anna.id), { from: "2026-10-01", to: "2026-10-31" }).totalMin).toBe(120)
  })

  it("raw export for leads (own teams, incl. deleted) and HR only", () => {
    expect(err(() => rawEntries(loadActor(org.anna.id), { from: "2026-10-01", to: "2026-10-31" })).code).toBe(
      "forbidden",
    )
    const rows = rawEntries(loadActor(org.lead.id), { from: "2026-10-01", to: "2026-10-31" })
    expect(rows.map((r) => `${r.name}:${r.minutes}:${r.deleted}`)).toEqual([
      "Anna Muster:240:false",
      "Anna Muster:60:true",
    ])
    expect(rows[0]).toMatchObject({
      startLocal: "2026-10-14 08:00",
      endUtc: "2026-10-14T10:00:00.000Z",
      timezone: "Europe/Zurich",
    })
    expect(rawEntries(loadActor(org.hr!.id), { from: "2026-10-01", to: "2026-10-31" })).toHaveLength(3)
  })
})
