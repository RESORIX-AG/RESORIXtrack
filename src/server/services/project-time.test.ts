import { beforeEach, describe, expect, it } from "vitest"
import { rawSqlite } from "@/server/db"
import { freeze } from "@/server/time"
import {
  loadActor,
  lockMonth,
  makeEntry,
  makeLead,
  makeSchedule,
  makeTeam,
  makeUser,
  withSettings,
} from "@/test/factories"
import { computeDays } from "./accounts"
import { clockAction, clockState, openEntry } from "./clock"
import { createEntry, listEntries, updateEntry } from "./entries"
import { daysMissingProjects, firstDayMissingProject, projectItems } from "./project-time"
import { listProjects, saveProject } from "./projects"
import { projectHours, timesheet } from "./reports"
import { blockers } from "./signoffs"

const TODAY = "2026-11-05"
const NOW = Date.parse("2026-11-05T14:00:00Z") // Thu 15:00 Zurich
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

beforeEach(() => freeze("2026-11-05T14:00:00Z"))

function org() {
  const team = makeTeam()
  const other = makeTeam()
  const lead = makeUser({ name: "Lea" })
  makeLead(team.id, lead.id)
  const anna = makeUser({ name: "Anna", teamId: team.id })
  const carl = makeUser({ name: "Carl", teamId: other.id })
  const pm = makeUser({ name: "Pia", capabilities: ["projects"] })
  for (const u of [anna, carl]) makeSchedule(u.id)
  const internal = saveProject(loadActor(pm.id), { name: "Internal", code: "INT" })
  return { team, other, lead, anna, carl, pm, internal }
}

describe("projects", () => {
  it("visibility and management", () => {
    const { team, other, lead, anna, carl, pm, internal } = org()
    const L = loadActor(lead.id)
    const P = loadActor(pm.id)
    const teamProject = saveProject(L, { name: "Team A work", teamId: team.id })
    expect(teamProject.canManage).toBe(true)
    expect(() => saveProject(L, { name: "Other", teamId: other.id })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    )
    expect(() => saveProject(L, { name: "Company" })).toThrow(expect.objectContaining({ code: "forbidden" }))
    expect(() => saveProject(loadActor(anna.id), { name: "Mine", teamId: team.id })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    )
    expect(() => saveProject(P, { name: "Internal" })).toThrow(expect.objectContaining({ code: "project_taken" }))
    expect(() => saveProject(P, { name: "X", color: "red" })).toThrow(
      expect.objectContaining({ fields: { color: "invalid" } }),
    )
    saveProject(P, { name: "Other team", teamId: other.id })
    expect(listProjects(loadActor(anna.id)).map((p) => p.name)).toEqual(["Internal", "Team A work"])
    expect(listProjects(loadActor(carl.id)).map((p) => p.name)).toEqual(["Internal", "Other team"])
    expect(listProjects(P).length).toBe(3)
    expect(saveProject(L, { isActive: false }, teamProject.id).isActive).toBe(false)
    expect(listProjects(loadActor(anna.id)).map((p) => p.name)).toEqual(["Internal"])
    expect(listProjects(loadActor(anna.id), true).map((p) => p.name)).toEqual(["Internal", "Team A work"])
    expect(saveProject(P, { code: "  AB-12  " }, internal.id).code).toBe("AB-12")
  })
})

describe("entries with a project", () => {
  it("create and change: visibility, inactive projects, revisions", () => {
    const { anna, carl, lead, pm, internal } = org()
    const A = loadActor(anna.id)
    const e = createEntry(A, { startAt: `${TODAY}T08:00`, endAt: `${TODAY}T10:00`, projectId: internal.id })
    expect(e).toMatchObject({ projectId: internal.id, project: { name: "Internal", code: "INT" } })
    const foreign = saveProject(loadActor(pm.id), { name: "Foreign", teamId: carl.teamId })
    expect(() => createEntry(A, { startAt: `${TODAY}T10:00`, endAt: `${TODAY}T11:00`, projectId: foreign.id })).toThrow(
      expect.objectContaining({ fields: { projectId: "invalid" } }),
    )
    expect(() => createEntry(A, { startAt: `${TODAY}T10:00`, endAt: `${TODAY}T11:00`, projectId: 999 })).toThrow(
      expect.objectContaining({ code: "not_found" }),
    )

    expect(updateEntry(A, e.id, { projectId: null })).toMatchObject({ projectId: null, project: null })
    // a lead books a member's entry on a project the member can see
    const L = loadActor(lead.id)
    expect(updateEntry(L, e.id, { projectId: internal.id }, "wrong project").projectId).toBe(internal.id)
    const revs = rawSqlite()
      .prepare(
        "SELECT action, json_extract(after, '$.project_id') AS p FROM revisions WHERE entity = 'time_entry' AND entity_id = ? ORDER BY id",
      )
      .all(e.id)
    expect(revs).toEqual([
      { action: "create", p: internal.id },
      { action: "update", p: null },
      { action: "update", p: internal.id },
    ])

    // an inactive project stays on entries that have it, but cannot be chosen anew
    saveProject(loadActor(pm.id), { isActive: false }, internal.id)
    expect(updateEntry(A, e.id, { note: "kept" }).projectId).toBe(internal.id)
    expect(() =>
      createEntry(A, { startAt: `${TODAY}T11:00`, endAt: `${TODAY}T12:00`, projectId: internal.id }),
    ).toThrow(expect.objectContaining({ fields: { projectId: "inactive" } }))
  })

  it("past days need a reason, signed-off months are read-only, the off mode refuses projects", () => {
    const { anna, internal } = org()
    const A = loadActor(anna.id)
    withSettings({ reason_required_for_past_edits: true })
    const old = makeEntry(anna.id, "2026-10-30T07:00:00.000000Z", "2026-10-30T15:00:00.000000Z")
    expect(() => updateEntry(A, old.id, { projectId: internal.id })).toThrow(
      expect.objectContaining({ fields: { reason: "required" } }),
    )
    lockMonth(anna.id, "2026-10")
    expect(() => updateEntry(A, old.id, { projectId: internal.id }, "forgot")).toThrow(
      expect.objectContaining({ code: "period_signed_off" }),
    )
    expect(() =>
      rawSqlite().prepare("UPDATE time_entries SET project_id = ? WHERE id = ?").run(internal.id, old.id),
    ).toThrow(/period signed off/)

    withSettings({ project_mode: "off" })
    expect(() =>
      createEntry(A, { startAt: `${TODAY}T08:00`, endAt: `${TODAY}T09:00`, projectId: internal.id }),
    ).toThrow(expect.objectContaining({ code: "projects_off" }))
    expect(createEntry(A, { startAt: `${TODAY}T08:00`, endAt: `${TODAY}T09:00` }).projectId).toBeNull()
  })
})

describe("clock with projects", () => {
  it("clocks in on a project and switches without a break", () => {
    const { anna, pm, internal } = org()
    const A = loadActor(anna.id)
    const client = saveProject(loadActor(pm.id), { name: "Client" })
    freeze(at(-180))
    clockAction(A, "start", { projectId: internal.id })
    expect(openEntry(anna.id)?.projectId).toBe(internal.id)
    freeze(at(-60))
    const state = clockAction(A, "switch", { projectId: client.id })
    expect(state).toMatchObject({ state: "working", since: at(-60) })
    expect(state.entry?.project?.name).toBe("Client")
    // the same project again changes nothing
    clockAction(A, "switch", { projectId: client.id })
    freeze(at(0))
    clockAction(A, "stop")
    const entries = listEntries(A, anna.id, TODAY, TODAY)
    expect(entries.map((e) => [e.project?.name, e.minutes])).toEqual([
      ["Internal", 120],
      ["Client", 60],
    ])
    expect(entries[0].endAt).toBe(entries[1].startAt)
    expect(clockState(anna).todayBreakMin).toBe(0)
    expect(computeDays(anna, TODAY, TODAY)[0]).toMatchObject({ workedMin: 180, breakMin: 0, projectMin: 180 })
  })

  it("a switch after hours of work is not a clock-in: the legal-rest check does not apply", () => {
    const { anna, internal } = org()
    const A = loadActor(anna.id)
    withSettings({ break_enforcement: true })
    makeEntry(anna.id, "2026-11-05T05:00:00.000000Z", "2026-11-05T11:00:00.000000Z") // 6 h, no break yet
    freeze(at(-180))
    // clocking in right after six hours is refused (break first) ...
    expect(() => clockAction(A, "start")).toThrow(expect.objectContaining({ code: "break_required" }))
    freeze(at(-150))
    clockAction(A, "start")
    // ... switching the project of the running entry is not
    freeze(at(-10))
    expect(clockAction(A, "switch", { projectId: internal.id }).state).toBe("working")
  })

  it("a clock-in on a project that is no longer available starts without it", () => {
    const { anna, pm } = org()
    const old = saveProject(loadActor(pm.id), { name: "Old", isActive: false })
    clockAction(loadActor(anna.id), "start", { projectId: old.id })
    expect(openEntry(anna.id)).toMatchObject({ projectId: null })
    expect(() => clockAction(loadActor(anna.id), "switch", { projectId: old.id })).toThrow(
      expect.objectContaining({ fields: { projectId: "inactive" } }),
    )
  })

  it("within the first minute a switch relabels the running entry; idle switch clocks in", () => {
    const { anna, pm, internal } = org()
    const A = loadActor(anna.id)
    const client = saveProject(loadActor(pm.id), { name: "Client" })
    clockAction(A, "switch", { projectId: internal.id })
    freeze(at(0.5))
    clockAction(A, "switch", { projectId: client.id })
    expect(listEntries(A, anna.id, TODAY, TODAY).map((e) => e.project?.name)).toEqual(["Client"])
  })

  it("a scheduled clock-out moves to the next entry", () => {
    const { anna, pm, internal } = org()
    const A = loadActor(anna.id)
    const client = saveProject(loadActor(pm.id), { name: "Client" })
    freeze(at(-60))
    clockAction(A, "start", { projectId: internal.id })
    clockAction(A, "stop", { at: at(120) })
    freeze(at(0))
    const state = clockAction(A, "switch", { projectId: client.id })
    expect(state.scheduledEnd).toBe(new Date(at(120)).toISOString())
  })
})

describe("coverage, sign-off and reports", () => {
  it("required mode flags past days with work without a project and blocks the sign-off", () => {
    const { anna, internal } = org()
    withSettings({ project_mode: "required" })
    makeEntry(anna.id, "2026-10-01T06:00:00.000000Z", "2026-10-01T10:00:00.000000Z", { projectId: internal.id })
    makeEntry(anna.id, "2026-10-02T06:00:00.000000Z", "2026-10-02T10:00:00.000000Z", { projectId: internal.id })
    const open = makeEntry(anna.id, "2026-10-05T06:00:00.000000Z", "2026-10-05T10:00:00.000000Z")
    expect(daysMissingProjects(anna, "2026-10-01", "2026-10-31")).toEqual(["2026-10-05"])
    expect(blockers(anna, "2026-10")).toContain("projects_missing")
    updateEntry(loadActor(anna.id), open.id, { projectId: internal.id }, "forgot")
    expect(blockers(anna, "2026-10")).not.toContain("projects_missing")
    withSettings({ project_mode: "optional" })
    makeEntry(anna.id, "2026-11-04T06:00:00.000000Z", "2026-11-04T10:00:00.000000Z")
    expect(firstDayMissingProject(anna)).toBeNull()
    withSettings({ project_mode: "required" })
    expect(firstDayMissingProject(anna)).toBe("2026-11-04")
  })

  it("the reminder skips days in signed-off months, which can no longer get a project", () => {
    const { anna } = org()
    withSettings({ project_mode: "required" })
    makeEntry(anna.id, "2026-10-27T07:00:00.000000Z", "2026-10-27T11:00:00.000000Z")
    expect(firstDayMissingProject(anna)).toBe("2026-10-27")
    lockMonth(anna.id, "2026-10")
    expect(firstDayMissingProject(anna)).toBeNull()
    makeEntry(anna.id, "2026-11-03T07:00:00.000000Z", "2026-11-03T11:00:00.000000Z")
    expect(firstDayMissingProject(anna)).toBe("2026-11-03")
  })

  it("project hours: entries split at midnight", () => {
    const { anna, lead, internal } = org()
    // a night shift over midnight, Zurich time 22:00-02:00
    makeEntry(anna.id, "2026-11-02T21:00:00.000000Z", "2026-11-03T01:00:00.000000Z", { projectId: internal.id })
    makeEntry(anna.id, "2026-11-04T07:00:00.000000Z", "2026-11-04T08:30:00.000000Z", { projectId: internal.id })
    makeEntry(anna.id, "2026-11-04T09:00:00.000000Z", "2026-11-04T10:00:00.000000Z")
    const items = projectItems([anna], "2026-10-01", "2026-11-30")
    expect(items.map((i) => [i.date, i.minutes, i.start, i.end])).toEqual([
      ["2026-11-02", 120, "22:00", "24:00"],
      ["2026-11-03", 120, "00:00", "02:00"],
      ["2026-11-04", 90, "08:00", "09:30"],
    ])
    const report = projectHours(loadActor(lead.id), { from: "2026-10-01", to: "2026-11-30" })
    expect(report.totalMin).toBe(330)
    expect(report.projects.map((r) => [r.kind, r.name, r.minutes])).toEqual([["project", "Internal", 330]])
    expect(timesheet(loadActor(anna.id), { year: 2026, month: 11 }).projectTime["2026-11-04"]).toEqual([
      { entryId: expect.any(Number), project: "Internal", note: "", minutes: 90, start: "08:00", end: "09:30" },
    ])
  })
})
