import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { strToU8, zipSync } from "fflate"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "@/server/db"
import * as s from "@/server/db/schema"
import { env } from "@/server/env"
import { encryptBuffer } from "@/server/services/backup-crypto"
import { createBackup } from "@/server/services/backups"
import { clearMailOutbox, mailOutbox } from "@/server/services/mail"
import { freeze } from "@/server/time"
import { makeEntry, makeOrg, makeUser } from "@/test/factories"
import anonymize from "./anonymize"
import decryptBackup from "./decrypt-backup"
import installHolidays from "./install-holidays"
import sendReminders from "./send-reminders"

let dir: string
let out: string[]
const saved = { ...env }

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rt-cli-"))
  out = []
  const capture = (...a: unknown[]) => void out.push(a.join(" "))
  vi.spyOn(console, "log").mockImplementation(capture)
  vi.spyOn(console, "error").mockImplementation(capture)
  Object.assign(env, {
    dataDir: dir,
    backupsDir: path.join(dir, "backups"),
    attachmentsDir: path.join(dir, "attachments"),
    brandingDir: path.join(dir, "branding"),
    backupPassword: "cli-test-password",
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(env, saved)
  rmSync(dir, { recursive: true, force: true })
})

describe("rt anonymize", () => {
  it("anonymises a former employee only after the retention period", async () => {
    freeze("2026-03-01T10:00:00Z")
    const u = makeUser({ email: "erika@example.nomail", employmentEnd: "2021-06-30", isActive: false })
    expect(await anonymize.run(["--email", "erika@example.nomail", "--yes"])).toBe(1)
    expect(out.join("\n")).toMatch(/retention period runs until 2026-06-30/)
    expect(db.select().from(s.users).where(eq(s.users.id, u.id)).get()?.anonymizedAt).toBeNull()

    freeze("2026-07-01T10:00:00Z")
    expect(await anonymize.run(["--email", "Erika@example.nomail", "--yes"])).toBe(0)
    const after = db.select().from(s.users).where(eq(s.users.id, u.id)).get()!
    expect(after.email).toBe(`anonymised-${u.id}@invalid.local`)
    const rev = db.select().from(s.revisions).where(eq(s.revisions.action, "anonymize")).get()!
    expect(rev).toMatchObject({ actorId: null, source: "cli", subjectUserId: u.id })

    expect(await anonymize.run(["--email", "nobody@example.nomail", "--yes"])).toBe(1)
    expect(await anonymize.run([])).toBe(2)
  })
})

describe("rt install-holidays", () => {
  it("installs a preset for the given years and makes it the default", () => {
    expect(installHolidays.run(["--preset", "CH-ZH", "--years", "2026,2027", "--default"])).toBe(0)
    const cal = db.select().from(s.holidayCalendars).where(eq(s.holidayCalendars.isDefault, true)).get()!
    expect(cal.regionCode).toBe("CH-ZH")
    const dates = db
      .select()
      .from(s.holidays)
      .where(eq(s.holidays.calendarId, cal.id))
      .all()
      .map((h) => h.date)
    expect(dates).toContain("2026-12-25")
    expect(dates).toContain("2027-08-01")
    // running it again adds nothing twice
    expect(installHolidays.run(["--preset", "CH-ZH", "--years", "2026,2027"])).toBe(0)
    expect(db.select().from(s.holidays).where(eq(s.holidays.calendarId, cal.id)).all()).toHaveLength(dates.length)

    expect(installHolidays.run(["--preset", "XX-YY"])).toBe(1)
    expect(out.at(-1)).toMatch(/^presets: .*CH-ZH/)
    expect(installHolidays.run(["--preset", "CH-ZH", "--years", "next"])).toBe(2)
  })

  it("--top-up adds the missing years of preset calendars", () => {
    expect(installHolidays.run(["--preset", "CH-BE", "--years", "1999"])).toBe(0)
    expect(installHolidays.run(["--top-up"])).toBe(0)
    expect(out.some((l) => /holidays added for \d{4}/.test(l))).toBe(true)
    expect(installHolidays.run(["--top-up"])).toBe(0)
    expect(out.at(-1)).toBe("nothing to add")
  })
})

describe("rt send-reminders", () => {
  it("runs the worker reminder job once", async () => {
    clearMailOutbox()
    const org = makeOrg()
    makeEntry(org.anna.id, "2026-11-04T21:00:00Z", null)
    expect(await sendReminders.run()).toBe(0)
    expect(out.at(-1)).toBe("1 reminder(s) sent")
    expect(mailOutbox().map((m) => m.to)).toEqual([org.anna.email])
  })
})

describe("rt decrypt-backup", () => {
  it("writes a v2 backup's files into the directory and nowhere else", async () => {
    makeUser()
    const info = await createBackup({ includeAttachments: false })
    const file = path.join(env.backupsDir, info.name)
    const target = path.join(dir, "out")
    expect(await decryptBackup.run([file, "--out", target])).toBe(0)
    expect(readdirSync(target).sort()).toEqual(["manifest.json", "resorixtrack.db"])
    expect(readFileSync(path.join(target, "resorixtrack.db")).subarray(0, 15).toString()).toBe("SQLite format 3")
    expect(out.join("\n")).toContain("checksums ok")
    expect(readdirSync(env.backupsDir)).toEqual([info.name])
    expect(readdirSync(dir).sort()).toEqual(["backups", "out"])

    // a non-empty target and a wrong password are refused
    expect(await decryptBackup.run([file, "--out", target])).toBe(1)
    Object.assign(env, { backupPassword: "wrong-password-123" })
    expect(await decryptBackup.run([file, "--out", path.join(dir, "out2")])).toBe(1)
    expect(out.at(-1)).toMatch(/Wrong backup password/)
    expect(existsSync(path.join(dir, "out2"))).toBe(false)
  })

  it("writes only safe names", async () => {
    const zip = zipSync({
      "resorixtrack.db": strToU8("SQLite format 3\0"),
      "attachments/0123456789abcdef0123456789abcdef": strToU8("%PDF-"),
      "../evil": strToU8("x"),
      "manifest.json": strToU8(
        JSON.stringify({ app: "resorixtrack", version: "1.0.0", format: 2, encrypted: "RTBK1" }),
      ),
    })
    mkdirSync(env.backupsDir)
    const file = path.join(env.backupsDir, "resorixtrack-20260101-020000-auto.zip.enc")
    writeFileSync(file, await encryptBuffer(zip, env.backupPassword))
    const target = path.join(dir, "old")
    expect(await decryptBackup.run([file, "-o", target])).toBe(0)
    expect(existsSync(path.join(target, "attachments", "0123456789abcdef0123456789abcdef"))).toBe(true)
    expect(existsSync(path.join(dir, "evil"))).toBe(false)
    expect(out.join("\n")).toContain("skipped unsafe names: ../evil")
  })
})

describe("scripts/decrypt-backup.mjs", () => {
  it("decrypts a backup to the same ZIP without the app", async () => {
    const zip = zipSync({ "manifest.json": strToU8("{}"), "big.bin": new Uint8Array(1_200_000).fill(7) }, { level: 0 })
    const file = path.join(dir, "b.zip.enc")
    writeFileSync(file, await encryptBuffer(zip, env.backupPassword, 512 * 1024))
    const dest = path.join(dir, "plain.zip")
    const run = (password: string) =>
      execFileSync(process.execPath, ["scripts/decrypt-backup.mjs", file, dest], {
        env: { ...process.env, BACKUP_PASSWORD: password },
        stdio: "pipe",
      })
    run(env.backupPassword)
    expect(Buffer.compare(readFileSync(dest), Buffer.from(zip))).toBe(0)
    rmSync(dest)
    expect(() => run("wrong-password-123")).toThrow()
    expect(existsSync(dest)).toBe(false)
  })
})
