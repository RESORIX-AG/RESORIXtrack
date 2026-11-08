/**
 * Regression tests of the November 2026 security audit: nobody grants themselves rights or credits themselves,
 * documents of signed months stay as they are, and a few input and log hardenings.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { toCsv } from "@/features/reports/render/files"
import {
  loadActor,
  lockMonth,
  makeAbsenceRow,
  makeCalendar,
  makeEntry,
  makeLead,
  makeOrg,
  makeUser,
} from "@/test/factories"
import { db, rawSqlite } from "./db"
import { absenceTypes, attachments, loginAttempts, projects, users } from "./db/schema"
import { env } from "./env"
import type { AppError } from "./errors"
import { createAbsence, getAbsenceDto, listAbsences } from "./services/absences"
import { createAdjustment } from "./services/accounts"
import { checkSvg, updateAbsenceType } from "./services/admin-settings"
import { addAttachment, deleteAttachment } from "./services/attachments"
import { BackupCryptoError, parseHeader } from "./services/backup-crypto"
import { createEntry, getEntry, listEntries } from "./services/entries"
import { holidaysFor } from "./services/holidays"
import { recordThrottled } from "./services/login-log"
import { passwordAloneRefused } from "./services/mfa-policy"
import { history } from "./services/revisions"
import { createSchedule } from "./services/schedules"
import { globalSearch } from "./services/search"
import { reopen, signOff } from "./services/signoffs"
import { addLead, setMembers } from "./services/teams"
import { ensureInvitable, retentionInfo, setEntitlement, updateUser } from "./services/users"

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
const dir = mkdtempSync(path.join(tmpdir(), "rt-hardening-"))
const originalDir = env.attachmentsDir

async function err(fn: () => unknown): Promise<AppError> {
  try {
    await fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected an error")
}

let org: ReturnType<typeof makeOrg>
const hr = () => loadActor(org.hr!.id)
const admin = () => loadActor(org.admin.id)
beforeEach(() => {
  env.attachmentsDir = dir
  org = makeOrg()
})
afterAll(() => {
  env.attachmentsDir = originalDir
  rmSync(dir, { recursive: true, force: true })
})

describe("nobody acts on their own time data or rights", () => {
  // a second HR person and administrator: someone else could always do it
  beforeEach(() => {
    makeUser({ name: "Hugo HR", capabilities: ["hr"] })
    makeUser({ name: "Adam Admin", role: "admin" })
  })

  it("HR cannot credit their own balance, set their own schedule or entitlement", async () => {
    const adjust = { account: "time" as const, amount: 6000, reason: "x" }
    expect((await err(() => createAdjustment(hr(), org.hr!.id, adjust))).code).toBe("forbidden")
    expect(createAdjustment(hr(), org.anna.id, adjust).amount).toBe(6000)
    const sched = {
      validFrom: "2026-12-01",
      pensumPercent: 50,
      minutes: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    }
    expect((await err(() => createSchedule(hr(), org.hr!.id, sched))).code).toBe("forbidden")
  })

  it("HR reopens other people's months, never their own", async () => {
    const own = lockMonth(org.hr!.id, "2026-09")
    expect((await err(() => reopen(hr(), own.id, "fix"))).code).toBe("not_for_yourself")
    const other = lockMonth(org.anna.id, "2026-09")
    expect(reopen(hr(), other.id, "fix").reopenedAt).not.toBeNull()
  })

  it("an administrator cannot grant themselves HR, leadership or vacation", async () => {
    expect((await err(() => updateUser(admin(), org.admin.id, { capabilities: ["hr"] }))).code).toBe("not_for_yourself")
    expect((await err(() => updateUser(admin(), org.admin.id, { vacationDaysPerYear: 99 }))).code).toBe(
      "not_for_yourself",
    )
    expect((await err(() => setEntitlement(admin(), org.admin.id, 2026, 99))).code).toBe("not_for_yourself")
    const lead = { userId: org.admin.id, role: "lead" as const, validFrom: null, validTo: null }
    expect((await err(() => addLead(admin(), org.teamA.id, lead))).code).toBe("not_for_yourself")
    // unchanged values and their own name are fine
    const me = db.select().from(users).where(eq(users.id, org.admin.id)).get()!
    expect(
      updateUser(admin(), org.admin.id, { name: "Ada A.", vacationDaysPerYear: me.vacationDaysPerYear }).name,
    ).toBe("Ada A.")
  })

  it("an administrator leading a team does not add people to it or move themselves", async () => {
    makeLead(org.teamB.id, org.admin.id)
    expect((await err(() => setMembers(admin(), org.teamB.id, [org.carl.id, org.anna.id]))).code).toBe(
      "not_for_yourself",
    )
    expect((await err(() => updateUser(admin(), org.anna.id, { teamId: org.teamB.id }))).code).toBe("not_for_yourself")
    expect((await err(() => updateUser(admin(), org.admin.id, { teamId: org.teamA.id }))).code).toBe("not_for_yourself")
    const cal = makeCalendar({ name: "Other" })
    expect((await err(() => updateUser(admin(), org.admin.id, { holidayCalendarId: cal.id }))).code).toBe(
      "not_for_yourself",
    )
    // removing people and other teams stay possible
    setMembers(admin(), org.teamB.id, [])
    expect(updateUser(admin(), org.anna.id, { teamId: org.teamA.id }).teamId).toBe(org.teamA.id)
  })

  it("employment dates stay in order and retention runs from the last record", async () => {
    expect((await err(() => updateUser(admin(), org.carl.id, { employmentEnd: "2001-01-01" }))).fields).toEqual({
      employmentEnd: "before_start",
    })
    makeEntry(org.carl.id, "2026-10-01T07:00:00.000000Z", "2026-10-01T15:00:00.000000Z")
    const carl = updateUser(admin(), org.carl.id, { employmentEnd: "2026-06-30" })
    expect(retentionInfo(carl).allowedFrom).toBe("2031-10-01")
  })

  it("logs capability changes made for someone else", () => {
    updateUser(admin(), org.anna.id, { capabilities: ["hr"] })
    const last = history("user", org.anna.id).at(-1)!
    expect(last.after?.capabilities).toEqual(["hr"])
    expect(last.before?.capabilities).toEqual([])
  })

  it("HR's own absence requests wait for someone else", () => {
    const a = createAbsence(hr(), { type: "vacation", startDate: "2026-12-14" })
    expect(a.status).toBe("pending")
  })
})

describe("when nobody else could do it", () => {
  it("the only HR person (no lead) handles their own balance, schedule and months", () => {
    const adjust = { account: "time" as const, amount: 60, reason: "only HR" }
    expect(createAdjustment(hr(), org.hr!.id, adjust).amount).toBe(60)
    const own = lockMonth(org.hr!.id, "2026-09")
    expect(reopen(hr(), own.id, "fix").reopenedAt).not.toBeNull()
    const me = db.select().from(users).where(eq(users.id, org.hr!.id)).get()!
    expect(signOff(hr(), me, "2026-09").month).toBe("2026-09")
    // with a lead of their own, the lead does it (another administrator moves them, from today)
    updateUser(admin(), org.hr!.id, { teamId: org.teamA.id })
    expect(() => createAdjustment(hr(), org.hr!.id, adjust)).toThrow()
  })

  it("the only administrator changes their own rights; requests nobody could decide are recorded", () => {
    expect(updateUser(admin(), org.admin.id, { capabilities: ["hr", "projects"] }).capabilities).toEqual([
      "hr",
      "projects",
    ])
    // the only HR person and administrator, nobody to ask
    db.update(users).set({ isActive: false }).where(eq(users.id, org.hr!.id)).run()
    db.update(users).set({ teamId: null }).where(eq(users.id, org.admin.id)).run()
    const a = createAbsence(loadActor(org.admin.id), { type: "vacation", startDate: "2026-12-14" })
    expect(a.status).toBe("approved")
  })
})

describe("holiday calendars of signed-off months", () => {
  it("stay with the month when another calendar is assigned later", () => {
    const zurich = makeCalendar({ name: "Zurich", isDefault: false }, [{ date: "2026-09-14", name: "Knabenschiessen" }])
    db.update(users).set({ holidayCalendarId: zurich.id }).where(eq(users.id, org.anna.id)).run()
    const anna = () => db.select().from(users).where(eq(users.id, org.anna.id)).get()!
    signOff(loadActor(org.lead.id), anna(), "2026-09")
    expect([...holidaysFor(anna(), "2026-09-01", "2026-12-31").keys()]).toEqual(["2026-09-14"])
    // moved to the default calendar from today: September keeps Zurich's day, December follows the new calendar
    updateUser(admin(), org.anna.id, { holidayCalendarId: null })
    expect(() =>
      rawSqlite().prepare("UPDATE users SET holiday_calendar_id = ? WHERE id = ?").run(zurich.id, org.anna.id),
    ).not.toThrow()
    expect(() => rawSqlite().prepare("DELETE FROM user_terms_history WHERE user_id = ?").run(org.anna.id)).toThrow(
      /signed off/,
    )
    updateUser(admin(), org.anna.id, { holidayCalendarId: null })
    expect([...holidaysFor(anna(), "2026-09-01", "2026-12-31").keys()].sort()).toEqual([
      "2026-09-14",
      "2026-12-08",
      "2026-12-25",
    ])
    expect(() => rawSqlite().prepare("UPDATE month_signoffs SET calendar_id = NULL").run()).toThrow(/immutable/)
  })
})

describe("documents of signed-off months", () => {
  it("cannot be added or removed, by the service or in the database", async () => {
    const sick = createAbsence(loadActor(org.anna.id), { type: "sick", startDate: "2026-11-02" })
    const att = addAttachment(loadActor(org.anna.id), sick.id, { filename: "note.pdf", data: PDF })
    lockMonth(org.anna.id, "2026-11")
    expect((await err(() => deleteAttachment(loadActor(org.anna.id), att.id))).code).toBe("period_signed_off")
    expect(
      (await err(() => addAttachment(loadActor(org.anna.id), sick.id, { filename: "b.pdf", data: PDF }))).code,
    ).toBe("period_signed_off")
    expect(() => rawSqlite().prepare("UPDATE attachments SET is_deleted = 1 WHERE id = ?").run(att.id)).toThrow(
      /signed off/,
    )
    expect(() => rawSqlite().prepare("DELETE FROM attachments WHERE id = ?").run(att.id)).toThrow(/signed off/)
    // anonymisation after the retention period still erases them
    db.update(attachments)
      .set({ isDeleted: true, size: 0, filename: "removed" })
      .where(eq(attachments.id, att.id))
      .run()
  })
})

describe("absence types in use", () => {
  it("keep their category and counting; the label may change", async () => {
    const vac = db.select().from(absenceTypes).where(eq(absenceTypes.key, "vacation")).get()!
    createAbsence(loadActor(org.anna.id), { type: "vacation", startDate: "2026-12-14" })
    expect((await err(() => updateAbsenceType(admin(), vac.id, { category: "other" }))).code).toBe(
      "type_in_use_counting",
    )
    expect((await err(() => updateAbsenceType(admin(), vac.id, { creditsTime: false }))).code).toBe(
      "type_in_use_counting",
    )
    expect(updateAbsenceType(admin(), vac.id, { label: "Holidays", category: "vacation" }).label).toBe("Holidays")
  })
})

describe("invitations", () => {
  it("are refused for people who signed in before (single sign-on, passkey)", async () => {
    expect(ensureInvitable(admin(), org.anna.id).id).toBe(org.anna.id)
    db.update(users).set({ lastLoginAt: "2026-11-01T08:00:00.000000Z" }).where(eq(users.id, org.anna.id)).run()
    expect((await err(() => ensureInvitable(admin(), org.anna.id))).code).toBe("invalid_state")
  })
})

describe("two-factor policy", () => {
  it("refuses a password alone while required and TOTP is off", async () => {
    const anna = () => db.select().from(users).where(eq(users.id, org.anna.id)).get()!
    expect(passwordAloneRefused(anna())).toBe(false)
    const { withSettings } = await import("@/test/factories")
    withSettings({ mfa_required_for_all: true })
    expect(passwordAloneRefused(anna())).toBe(true)
    db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, org.anna.id)).run()
    expect(passwordAloneRefused(anna())).toBe(false)
  })
})

describe("search", () => {
  it("lists only projects the person may book on", () => {
    db.insert(projects).values({ name: "Secret B project", teamId: org.teamB.id }).run()
    db.insert(projects).values({ name: "Secret shared", teamId: null }).run()
    const titles = globalSearch(loadActor(org.anna.id), "secret").map((h) => h.title)
    expect(titles).toEqual(["Secret shared"])
    expect(globalSearch(loadActor(org.carl.id), "secret").map((h) => h.title)).toContain("Secret B project")
  })
})

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
const header = (t: number, p: number) =>
  Buffer.from(
    JSON.stringify({
      v: 1,
      kdf: "argon2id",
      t,
      m: 65536,
      p,
      salt: Buffer.alloc(16).toString("base64"),
      cipher: "chacha20poly1305",
      chunk: 65536,
    }),
  )

describe("input hardening", () => {
  it("refuses SVG logos with namespace-prefixed active elements", () => {
    expect(() => checkSvg(svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>'))).toThrow()
    expect(() => checkSvg(svg('<a:foreignObject xmlns:a="http://www.w3.org/2000/svg"/>'))).toThrow()
    expect(() =>
      checkSvg(svg('<use x:href="https://evil.example/x.svg#a" xmlns:x="http://www.w3.org/1999/xlink"/>')),
    ).toThrow()
    expect(() => checkSvg(svg('<sodipodi:namedview id="n"/><circle r="4"/>'))).not.toThrow()
  })

  it("refuses backup headers with absurd key-derivation costs", () => {
    expect(parseHeader(header(3, 1)).t).toBe(3)
    expect(() => parseHeader(header(2 ** 31, 1))).toThrow(BackupCryptoError)
    expect(() => parseHeader(header(3, 1000))).toThrow(BackupCryptoError)
  })

  it("guards CSV headers against formulas", () => {
    const csv = new TextDecoder().decode(
      toCsv(
        { title: "t", columns: [{ header: '=HYPERLINK("x")', kind: "text" }], rows: [] },
        { locale: "en", intl: "en-CH", yes: "yes", hoursSuffix: "h", daysUnit: "d" },
      ),
    )
    expect(csv.replace(/^﻿/, "").split("\r\n")[0]).toBe('"\'=HYPERLINK(""x"")"')
  })

  it("stores an unknown address masked even when throttled", () => {
    recordThrottled("my secret password", new Headers({ "x-resorixtrack-peer": "10.0.0.3" }))
    const row = db.select().from(loginAttempts).all().at(-1)!
    expect(row.reason).toBe("throttled")
    expect(row.email).toBe("my***")
  })
})

describe("a lead or deputy covering from a given day", () => {
  // Carl (team B) gets a deputy for November and December; his team has no other lead
  let deputy: ReturnType<typeof makeUser>
  beforeEach(() => {
    deputy = makeUser({ name: "Tina Temporary" })
    makeLead(org.teamB.id, deputy.id, { role: "deputy", validFrom: "2026-11-01", validTo: "2026-12-31" })
  })
  const tina = () => loadActor(deputy.id)

  it("sees the member's data from that day on only", async () => {
    const old = makeEntry(org.carl.id, "2026-10-05T07:00:00Z", "2026-10-05T15:00:00Z", { note: "october" })
    const now = makeEntry(org.carl.id, "2026-11-02T07:00:00Z", "2026-11-02T15:00:00Z", { note: "november" })
    expect(listEntries(tina(), org.carl.id, "2026-10-01", "2026-11-30").map((e) => e.id)).toEqual([now.id])
    expect((await err(() => getEntry(tina(), old.id))).code).toBe("not_found")
    expect(getEntry(tina(), now.id).id).toBe(now.id)
    const oldSick = makeAbsenceRow(org.carl.id, sickType(), "2026-10-20", "2026-10-21")
    const ongoing = makeAbsenceRow(org.carl.id, sickType(), "2026-10-30", "2026-11-03")
    expect(
      listAbsences(tina(), { userId: org.carl.id, from: "2026-10-01", to: "2026-11-30" }).map((a) => a.id),
    ).toEqual([ongoing.id])
    expect((await err(() => getAbsenceDto(tina(), oldSick.id))).code).toBe("not_found")
  })

  it("changes nothing before it", async () => {
    const entry = { userId: org.carl.id, startAt: "2026-10-28T08:00:00Z", endAt: "2026-10-28T12:00:00Z", reason: "x" }
    expect((await err(() => createEntry(tina(), entry))).code).toBe("before_cover")
    const absence = { userId: org.carl.id, type: "vacation", startDate: "2026-10-30", endDate: "2026-11-03" }
    expect((await err(() => createAbsence(tina(), absence))).code).toBe("before_cover")
    expect((await err(() => signOff(tina(), carl(), "2026-10"))).code).toBe("before_cover")
    expect(
      createEntry(tina(), { ...entry, startAt: "2026-11-04T08:00:00Z", endAt: "2026-11-04T12:00:00Z" }).id,
    ).toBeTruthy()
  })

  it("a permanent lead, or a permanent role next to the cover, sees everything", () => {
    const old = makeEntry(org.carl.id, "2026-10-05T07:00:00Z", "2026-10-05T15:00:00Z")
    makeLead(org.teamB.id, deputy.id, { role: "lead" })
    expect(getEntry(tina(), old.id).id).toBe(old.id)
  })
})

const carl = () => db.select().from(users).where(eq(users.id, org.carl.id)).get()!
const sickType = () => db.select().from(absenceTypes).where(eq(absenceTypes.key, "sick")).get()!.id
