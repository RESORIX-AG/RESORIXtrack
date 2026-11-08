import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { rawSqlite } from "@/server/db"
import { makeAdmin, makeEntry, makeLead, makeTeam, makeUser, withSettings } from "@/test/factories"
import { db } from "../db"
import * as s from "../db/schema"
import { freeze } from "../time"
import { loadActor } from "./permissions"
import { getAllSettings } from "./settings"
import {
  anonymizeUser,
  createUser,
  getUserDetail,
  listUsers,
  removePasskeys,
  resetTwoFactor,
  setActive,
  setEntitlement,
  setPasswordByAdmin,
  updateUser,
  userHistory,
} from "./users"

function signOff(userId: number, month: string, start: string, end: string) {
  db.insert(s.monthSignoffs)
    .values({
      userId,
      month,
      periodStartDate: start,
      periodEndDate: end,
      periodStartUtc: `${start}T00:00:00.000000Z`,
      periodEndUtc: `${end}T23:59:59.000000Z`,
      digest: "d",
      seal: "s",
    })
    .run()
}

function addPasskey(userId: number, id: string) {
  db.insert(s.passkey)
    .values({ userId, publicKey: "pk", credentialID: id, counter: 0, deviceType: "singleDevice", backedUp: false })
    .run()
}
const passkeysOf = (userId: number) => db.select().from(s.passkey).where(eq(s.passkey.userId, userId)).all().length

/** A password reset link as Better Auth stores it (identifier hashed, value the user id). */
function resetLink(userId: number) {
  db.insert(s.verification)
    .values({ identifier: `hashed-${userId}`, value: String(userId), expiresAt: new Date(Date.now() + 1e6) })
    .run()
}
const resetLinksOf = (userId: number) =>
  db
    .select()
    .from(s.verification)
    .where(eq(s.verification.value, String(userId)))
    .all().length

describe("users administration", () => {
  it("handles passkeys separately from two-factor; deactivation removes them", () => {
    const admin = loadActor(makeAdmin().id)
    const u = makeUser({ twoFactorEnabled: true })
    db.insert(s.twoFactor).values({ userId: u.id, secret: "x", backupCodes: "y" }).run()
    addPasskey(u.id, "c1")
    addPasskey(u.id, "c2")
    expect(getUserDetail(admin, u.id).passkeys).toBe(2)
    resetTwoFactor(admin, u.id)
    expect(passkeysOf(u.id)).toBe(2)
    expect(removePasskeys(admin, u.id)).toBe(2)
    expect(() => removePasskeys(admin, u.id)).toThrow(/no passkeys/)
    addPasskey(u.id, "c3")
    setActive(admin, u.id, false)
    expect(passkeysOf(u.id)).toBe(0)
  })

  it("is for administrators only", () => {
    const emp = loadActor(makeUser().id)
    const hr = loadActor(makeUser({ capabilities: ["hr"] }).id)
    const other = makeUser()
    for (const a of [emp, hr]) {
      expect(() => listUsers(a)).toThrow(/Administrators only/)
      expect(() => getUserDetail(a, other.id)).toThrow(/Administrators only/)
      expect(() => createUser(a, { name: "X", email: "x@example.nomail" })).toThrow(/Administrators only/)
      expect(() => updateUser(a, other.id, { name: "Y" })).toThrow(/Administrators only/)
      expect(() => setActive(a, other.id, false)).toThrow(/Administrators only/)
      expect(() => userHistory(a, other.id)).toThrow(/Administrators only/)
    }
  })

  it("creates a person with a default schedule and logs it", () => {
    const admin = loadActor(makeAdmin().id)
    withSettings({ fulltime_weekly_minutes: 2400 })
    const u = createUser(admin, {
      name: " Anna Muster ",
      email: "Anna@Example.nomail",
      pensumPercent: 50,
      employmentStart: "2026-03-01",
    })
    expect(u.email).toBe("anna@example.nomail")
    expect(u.name).toBe("Anna Muster")
    const d = getUserDetail(admin, u.id)
    expect(d.invitePending).toBe(true)
    expect(d.schedules).toEqual([
      {
        id: expect.any(Number),
        validFrom: "2026-03-01",
        pensumPercent: 50,
        minutes: { mon: 240, tue: 240, wed: 240, thu: 240, fri: 240, sat: 0, sun: 0 },
      },
    ])
    expect(
      userHistory(admin, u.id)
        .map((h) => `${h.entity}.${h.action}`)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["schedule.create", "user.create"])
    expect(() => createUser(admin, { name: "Dup", email: "anna@example.nomail" })).toThrow(/already in use/)
    expect(() => createUser(admin, { name: "Bad", email: "not-an-email" })).toThrow(/Invalid email/)
  })

  it("sets the senior-executive flag (ArG Art. 3 lit. d) and logs the change", () => {
    const admin = loadActor(makeAdmin().id)
    withSettings({ weekly_max_minutes: 3000 })
    const u = createUser(admin, { name: "Eva Chef", email: "eva@example.nomail" })
    expect(getUserDetail(admin, u.id)).toMatchObject({ argExempt: false, legalWeeklyMaxHours: 50 })
    const updates = () => userHistory(admin, u.id).filter((h) => h.entity === "user" && h.action === "update")
    updateUser(admin, u.id, { argExempt: true })
    expect(getUserDetail(admin, u.id).argExempt).toBe(true)
    expect(updates()).toHaveLength(1)
    updateUser(admin, u.id, { name: "Eva Chef" })
    expect(getUserDetail(admin, u.id).argExempt).toBe(true)
    expect(updates()).toHaveLength(1)
  })

  it("sets regular night work (ArG Art. 17b para. 2) and logs the change", () => {
    const admin = loadActor(makeAdmin().id)
    const u = createUser(admin, { name: "Nora Nacht", email: "nora@example.nomail" })
    expect(getUserDetail(admin, u.id).regularNightWork).toBe(false)
    updateUser(admin, u.id, { regularNightWork: true })
    expect(getUserDetail(admin, u.id).regularNightWork).toBe(true)
    expect(userHistory(admin, u.id).filter((h) => h.entity === "user" && h.action === "update")).toHaveLength(1)
  })

  it("accepts only 45 h or 50 h as the company weekly maximum (ArG Art. 9)", () => {
    expect(() => withSettings({ weekly_max_minutes: 2880 })).toThrow(/Invalid settings/)
    withSettings({ weekly_max_minutes: 2700, break_rules_enabled: false })
    expect(getAllSettings()).not.toHaveProperty("break_rules_enabled")
  })

  it("filters the list by team, role and status", () => {
    const admin = loadActor(makeAdmin({ name: "Admin" }).id)
    const team = makeTeam()
    const lead = makeUser({ name: "Lea", teamId: team.id })
    makeLead(team.id, lead.id)
    makeUser({ name: "Hans", capabilities: ["hr"] })
    makeUser({ name: "Old", isActive: false })
    expect(listUsers(admin, { teamId: team.id }).map((u) => u.name)).toEqual(["Lea"])
    expect(listUsers(admin, { role: "lead" }).map((u) => u.name)).toEqual(["Lea"])
    const deputy = makeUser({ name: "Dina", teamId: team.id })
    makeLead(team.id, deputy.id, { role: "deputy" })
    expect(listUsers(admin, { role: "lead" }).map((u) => [u.name, u.isDeputy])).toEqual([
      ["Dina", true],
      ["Lea", false],
    ])
    expect(listUsers(admin, { role: "hr" }).map((u) => u.name)).toEqual(["Hans"])
    expect(listUsers(admin, { status: "inactive" }).map((u) => u.name)).toEqual(["Old"])
    expect(listUsers(admin, { q: "HAN" }).map((u) => u.name)).toEqual(["Hans"])
  })

  it("blocks employment date changes that touch a signed-off month", () => {
    const admin = loadActor(makeAdmin().id)
    const u = makeUser({ employmentStart: "2025-01-01" })
    signOff(u.id, "2026-01", "2026-01-01", "2026-01-31")
    expect(() => updateUser(admin, u.id, { employmentStart: "2026-01-10" })).toThrow(/signed-off/)
    expect(() => updateUser(admin, u.id, { employmentEnd: "2026-01-15" })).toThrow(/signed-off/)
    // only the days that change count: moving the start within 2025 leaves January 2026 alone
    expect(updateUser(admin, u.id, { employmentStart: "2025-06-01" }).employmentStart).toBe("2025-06-01")
    expect(updateUser(admin, u.id, { employmentStart: "2025-01-01" }).employmentStart).toBe("2025-01-01")
    // an end after the signed month leaves it untouched (service and database guard agree)
    expect(updateUser(admin, u.id, { employmentEnd: "2026-06-30" }).employmentEnd).toBe("2026-06-30")
    expect(() => rawSqlite().prepare("UPDATE users SET employment_end = '2026-01-10' WHERE id = ?").run(u.id)).toThrow(
      /period signed off/,
    )
    expect(() =>
      rawSqlite().prepare("UPDATE users SET employment_start = '2026-01-20' WHERE id = ?").run(u.id),
    ).toThrow(/period signed off/)
  })

  it("keeps at least one active administrator and refuses self-deactivation", () => {
    const me = makeAdmin()
    const admin = loadActor(me.id)
    expect(() => updateUser(admin, me.id, { role: "employee" })).toThrow(/At least one active administrator/)
    expect(() => setActive(admin, me.id, false)).toThrow(/yourself/)
  })

  it("deactivation ends sessions, stops the clock and removes lead roles", () => {
    freeze("2026-05-04T15:00:00Z")
    const admin = loadActor(makeAdmin().id)
    const team = makeTeam()
    const u = makeUser({ teamId: team.id })
    makeLead(team.id, u.id)
    db.insert(s.session)
      .values({ userId: u.id, token: "t1", expiresAt: new Date(Date.now() + 1e6), updatedAt: new Date() })
      .run()
    const running = makeEntry(u.id, "2026-05-04T07:00:00.000000Z", null)
    setActive(admin, u.id, false)
    expect(db.select().from(s.session).where(eq(s.session.userId, u.id)).all()).toHaveLength(0)
    expect(db.select().from(s.timeEntries).where(eq(s.timeEntries.id, running.id)).get()?.endAt).toBe(
      "2026-05-04T15:00:00.000000Z",
    )
    expect(db.select().from(s.teamLeads).where(eq(s.teamLeads.userId, u.id)).all()).toHaveLength(0)
    expect(setActive(admin, u.id, true).isActive).toBe(true)
  })

  it("an email change ends pending password reset links, stored under a hashed identifier", () => {
    const admin = loadActor(makeAdmin().id)
    const u = makeUser()
    const other = makeUser()
    resetLink(u.id)
    resetLink(other.id)
    updateUser(admin, u.id, { email: "moved@example.nomail" })
    expect(resetLinksOf(u.id)).toBe(0)
    expect(resetLinksOf(other.id)).toBe(1)
  })

  it("sets a password (revoking sessions) and resets two-factor", () => {
    const admin = loadActor(makeAdmin().id)
    const u = makeUser({ twoFactorEnabled: true })
    db.insert(s.twoFactor).values({ userId: u.id, secret: "x", backupCodes: "y" }).run()
    db.insert(s.session)
      .values({ userId: u.id, token: "t2", expiresAt: new Date(Date.now() + 1e6), updatedAt: new Date() })
      .run()
    setPasswordByAdmin(admin, u.id, "$argon2id$fake", { notify: true })
    expect(getUserDetail(admin, u.id).invitePending).toBe(false)
    expect(db.select().from(s.session).where(eq(s.session.userId, u.id)).all()).toHaveLength(0)
    expect(() => setPasswordByAdmin(admin, admin.id, "$argon2id$fake", { notify: false })).toThrow(/profile/)
    resetTwoFactor(admin, u.id)
    expect(getUserDetail(admin, u.id).mfaEnabled).toBe(false)
    expect(db.select().from(s.twoFactor).where(eq(s.twoFactor.userId, u.id)).all()).toHaveLength(0)
    expect(() => resetTwoFactor(admin, u.id)).toThrow(/not enabled/)
  })

  it("sets and clears per-year vacation entitlements", () => {
    const admin = loadActor(makeAdmin().id)
    const u = makeUser()
    setEntitlement(admin, u.id, 2026, 27.5, "5 years")
    expect(getUserDetail(admin, u.id).entitlements).toEqual([
      { id: expect.any(Number), year: 2026, days: 27.5, note: "5 years" },
    ])
    setEntitlement(admin, u.id, 2026, null)
    expect(getUserDetail(admin, u.id).entitlements).toEqual([])
    expect(() => setEntitlement(loadActor(makeUser().id), u.id, 2026, 30)).toThrow(/not found/)
  })

  it("anonymises a former employee only after the retention period", () => {
    freeze("2026-06-01T10:00:00Z")
    withSettings({ retention_years: 5 })
    const admin = loadActor(makeAdmin().id)
    const u = makeUser({
      name: "Erika Beispiel",
      email: "erika@example.nomail",
      employmentEnd: "2021-06-30",
      birthDate: "1980-01-01",
    })
    makeEntry(u.id, "2021-06-01T07:00:00.000000Z", "2021-06-01T15:00:00.000000Z")
    expect(() => anonymizeUser(admin, u.id)).toThrow(/Deactivate/)
    setActive(admin, u.id, false)
    expect(() => anonymizeUser(admin, u.id)).toThrow(/retention period runs until 2026-06-30/)
    freeze("2026-07-01T10:00:00Z")
    anonymizeUser(admin, u.id)
    const after = db.select().from(s.users).where(eq(s.users.id, u.id)).get()!
    expect(after.name).toBe(`Former employee #${u.id}`)
    expect(after.email).toBe(`anonymised-${u.id}@invalid.local`)
    expect(after.birthDate).toBeNull()
    expect(after.anonymizedAt).toBeTruthy()
    expect(db.select().from(s.timeEntries).where(eq(s.timeEntries.userId, u.id)).all()).toHaveLength(1)
    const history = JSON.stringify(db.select().from(s.revisions).where(eq(s.revisions.entityId, u.id)).all())
    expect(history).not.toMatch(/Erika|erika@/)
    expect(() => rawSqlite().prepare("UPDATE revisions SET reason = 'x' WHERE entity = 'user'").run()).toThrow(
      /append-only/,
    )
    expect(() => anonymizeUser(admin, u.id)).toThrow(/already anonymised/)
  })
})
