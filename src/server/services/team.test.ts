import { beforeEach, describe, expect, it } from "vitest"
import type { AppError } from "@/server/errors"
import { loadActor, makeEntry, makeOrg } from "@/test/factories"
import { createAbsence } from "./absences"
import { vacationAccount } from "./accounts"
import { pendingApprovals } from "./approvals"
import { pendingApprovalCount } from "./approvals-count"
import { getUserOr404 } from "./permissions"
import { memberDetail, teamOverview } from "./team"

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
})

describe("team overview", () => {
  it("shows presence, absences and figures of the lead's team", () => {
    makeEntry(org.ben.id, "2026-11-05T07:00:00.000000Z", null)
    createAbsence(loadActor(org.anna.id), { type: "sick", startDate: "2026-11-05" })
    createAbsence(loadActor(org.lead.id), { userId: org.anna.id, type: "vacation", startDate: "2026-11-06" })
    const ov = teamOverview(loadActor(org.lead.id))
    expect(ov.month).toBe("2026-11")
    expect(ov.week).toEqual({ start: "2026-11-02", end: "2026-11-08" })
    const byId = new Map(ov.members.map((m) => [m.user.id, m]))
    expect([...byId.keys()].sort((a, b) => a - b)).toEqual([org.lead.id, org.anna.id, org.ben.id].sort((a, b) => a - b))
    expect(byId.get(org.ben.id)?.presence.state).toBe("working")
    expect(byId.get(org.anna.id)?.absentToday.map((a) => a.type.key)).toEqual(["sick"])
    expect(byId.get(org.anna.id)?.absencesThisWeek.map((a) => a.daysThisWeek)).toEqual([1, 1])
    expect(byId.get(org.anna.id)?.vacation.planned).toBe(1)
    expect(ov.totals).toEqual({ people: 3, working: 1, absentToday: 1 })
    expect(byId.get(org.anna.id)?.findings).not.toBeNull()
  })

  it("shows the lead's own findings on their own row", () => {
    makeEntry(org.lead.id, "2026-11-04T07:00:00.000000Z", "2026-11-04T16:30:00.000000Z")
    const own = teamOverview(loadActor(org.lead.id)).members.find((m) => m.user.id === org.lead.id)
    expect(own?.findings?.violation).toBeGreaterThan(0)
  })

  it("is for leads and HR only", () => {
    expect(err(() => teamOverview(loadActor(org.anna.id))).code).toBe("forbidden")
    expect(err(() => teamOverview(loadActor(org.admin.id))).code).toBe("forbidden")
    expect(teamOverview(loadActor(org.hr!.id), { teamId: org.teamB.id }).members.map((m) => m.user.id)).toEqual([
      org.carl.id,
    ])
  })
})

describe("member page", () => {
  it("gives a lead the member's data and nothing outside the team", () => {
    makeEntry(org.anna.id, "2026-11-04T07:00:00.000000Z", "2026-11-04T15:00:00.000000Z")
    const m = memberDetail(loadActor(org.lead.id), org.anna.id)
    expect(m.user).toMatchObject({ name: "Anna Muster", team: { name: "Team A" }, pensumPercent: 100 })
    expect(m.recentDays).toHaveLength(14)
    expect(m.recentDays.find((d) => d.date === "2026-11-04")?.workedMin).toBe(480)
    expect(m.permissions).toEqual({ manage: true, editSchedule: true, adjustBalance: true })
    expect(err(() => memberDetail(loadActor(org.lead.id), org.carl.id)).code).toBe("not_found")
    expect(err(() => memberDetail(loadActor(org.ben.id), org.anna.id)).code).toBe("not_found")
    expect(err(() => memberDetail(loadActor(org.admin.id), org.anna.id)).code).toBe("not_found")
  })
})

describe("approvals", () => {
  it("lists the requests with vacation left and anonymised overlaps", () => {
    createAbsence(loadActor(org.ben.id), { type: "sick", startDate: "2026-11-05" })
    createAbsence(loadActor(org.lead.id), { userId: org.ben.id, type: "vacation", startDate: "2026-12-16" })
    const before = vacationAccount(getUserOr404(org.anna.id), 2026).remainingAfterPending
    const req = createAbsence(loadActor(org.anna.id), {
      type: "vacation",
      startDate: "2026-11-05",
      endDate: "2026-12-18",
    })
    expect(pendingApprovalCount(loadActor(org.lead.id))).toBe(1)
    expect(pendingApprovalCount(loadActor(org.anna.id))).toBe(0)
    const [item] = pendingApprovals(loadActor(org.lead.id))
    expect(item.id).toBe(req.id)
    expect(item.vacationAfter).toBe(before - item.days)
    expect(item.overlaps.map((o) => `${o.typeKey}:${o.days}`).sort()).toEqual(["sick:1", "vacation:1"])
    // HR sees it as well; for a person outside their teams HR still sees details, administrators nothing
    expect(pendingApprovals(loadActor(org.hr!.id)).map((x) => x.id)).toEqual([req.id])
    expect(pendingApprovals(loadActor(org.admin.id))).toEqual([])
  })
})
