import { describe, expect, it } from "vitest"
import { makeAdmin, makeLead, makeTeam, makeUser } from "@/test/factories"
import {
  canManageUser,
  canViewProfile,
  canViewUser,
  ensureNotJoiningOwnTeam,
  loadActor,
  requireSomeoneElse,
  visibleUserIds,
} from "./permissions"

describe("permissions", () => {
  it("isolates employees, scopes leads, keeps admins away from time data", () => {
    const team = makeTeam()
    const other = makeTeam()
    const lead = makeUser()
    makeLead(team.id, lead.id)
    const member = makeUser({ teamId: team.id })
    const stranger = makeUser({ teamId: other.id })
    const admin = makeAdmin()
    const hr = makeUser({ capabilities: ["hr"] })

    const L = loadActor(lead.id)
    expect(canViewUser(L, member)).toBe(true)
    expect(canViewUser(L, stranger)).toBe(false)
    expect(canManageUser(L, member)).toBe(true)
    expect(canManageUser(L, L.user)).toBe(false)

    const E = loadActor(member.id)
    expect(canViewUser(E, stranger)).toBe(false)
    expect(visibleUserIds(E)).toEqual([member.id])

    const A = loadActor(admin.id)
    expect(canViewUser(A, member)).toBe(false)
    expect(canViewProfile(A, member)).toBe(true)

    expect(visibleUserIds(loadActor(hr.id))).toBeNull()
  })

  it("respects deputy validity periods", () => {
    const team = makeTeam()
    const deputy = makeUser()
    makeLead(team.id, deputy.id, { role: "deputy", validFrom: "2000-01-01", validTo: "2000-12-31" })
    expect(loadActor(deputy.id).ledTeamIds.size).toBe(0)
  })

  it("leaves changes for oneself to another administrator; HR only where exempt; a lone administrator acts", () => {
    const team = makeTeam()
    const hrAdmin = makeAdmin({ capabilities: ["hr"] })
    makeLead(team.id, hrAdmin.id)
    const someone = makeUser()
    const self = (id: number, hrExempt: boolean) => () =>
      requireSomeoneElse(loadActor(hrAdmin.id), id, "x", { hrExempt })
    // alone: nobody else could
    expect(self(hrAdmin.id, false)).not.toThrow()
    makeAdmin()
    expect(self(hrAdmin.id, false)).toThrow(expect.objectContaining({ code: "not_for_yourself" }))
    expect(self(hrAdmin.id, true)).not.toThrow()
    expect(self(someone.id, false)).not.toThrow()
    expect(() => ensureNotJoiningOwnTeam(loadActor(hrAdmin.id), team.id)).not.toThrow()
    const plainAdmin = makeAdmin()
    makeLead(team.id, plainAdmin.id)
    expect(() => ensureNotJoiningOwnTeam(loadActor(plainAdmin.id), team.id)).toThrow(
      expect.objectContaining({ code: "not_for_yourself" }),
    )
    expect(() => ensureNotJoiningOwnTeam(loadActor(plainAdmin.id), null)).not.toThrow()
  })
})
