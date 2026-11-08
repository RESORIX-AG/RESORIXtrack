import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createDb, MIGRATIONS_DIR, migrationStatus, openSqlite, rawSqlite, runMigrations } from "@/server/db"
import { env } from "@/server/env"
import { migrateDatabase } from "./migrate"

let dir: string
let lines: string[]
const saved = { ...env }
const log = (l: string) => lines.push(l)
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rt-migrate-"))
  lines = []
  Object.assign(env, {
    dataDir: dir,
    backupsDir: path.join(dir, "backups"),
    backupPassword: "migrate-test-password",
    setupCodeRequired: true,
  })
})

afterEach(() => {
  try {
    rawSqlite().close()
  } catch {}
  Object.assign(env, saved)
  rmSync(dir, { recursive: true, force: true })
})

/** A migrations folder with only the first `n` migrations: a database migrated with it is "older". */
function olderFolder(n: number): string {
  const folder = path.join(dir, "older")
  mkdirSync(path.join(folder, "meta"), { recursive: true })
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"))
  journal.entries = journal.entries.slice(0, n)
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify(journal))
  for (const e of journal.entries)
    copyFileSync(path.join(MIGRATIONS_DIR, `${e.tag}.sql`), path.join(folder, `${e.tag}.sql`))
  return folder
}

function olderDatabase(file: string, withUser: boolean) {
  const sqlite = openSqlite(file)
  runMigrations(createDb(sqlite), olderFolder(2))
  if (withUser) sqlite.prepare("INSERT INTO users (email, name) VALUES ('ada@example.nomail', 'Ada')").run()
  sqlite.close()
}

/** A database at 0004 with a person and the given surcharge, then migrated to the latest version. */
function settingsAfter(percent: string | null) {
  const file = path.join(dir, `s${percent}.db`)
  const sqlite = openSqlite(file)
  runMigrations(createDb(sqlite), olderFolder(5))
  sqlite.prepare("INSERT INTO users (email, name) VALUES ('ada@example.nomail', 'Ada')").run()
  if (percent)
    sqlite.prepare("INSERT INTO settings (key, value) VALUES ('holiday_work_surcharge_percent', ?)").run(percent)
  sqlite.prepare("INSERT INTO holiday_calendars (name, region_code) VALUES ('CH-FR City of Fribourg', 'CH-FR')").run()
  runMigrations(createDb(sqlite))
  const rows = sqlite.prepare("SELECT key, value FROM settings ORDER BY key").all()
  const cal = sqlite.prepare("SELECT region_code AS r, preset_days AS d FROM holiday_calendars").get()
  sqlite.close()
  return { rows, cal }
}

describe("rt migrate", () => {
  it("backs up a used database before applying pending migrations", async () => {
    const file = path.join(dir, "rt.db")
    olderDatabase(file, true)
    expect(await migrateDatabase({ file, check: true, log })).toBe(1)
    expect(lines.at(-1)).toMatch(
      /^pending: 0002_passkeys, 0003_guards_v2, 0004_arg_exempt, 0005_regular_night_work, 0006_clock_out_later, 0007_canton_presets, 0008_entry_projects, 0009_attachment_guards, 0010_signoff_calendar, 0011_dated_terms, 0012_rehire_guard$/,
    )
    expect(await migrateDatabase({ file, log })).toBe(0)
    const backups = readdirSync(path.join(dir, "backups"))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/-premigrate\.zip\.enc$/)
    expect(lines.some((l) => l.startsWith("applying 11 migration(s)"))).toBe(true)
    expect(migrationStatus(rawSqlite()).pending).toEqual([])
    // a user exists: no setup code
    expect(lines.join("\n")).not.toContain("first-run setup")
    rawSqlite().close()
    lines = []
    expect(await migrateDatabase({ file, check: true, log })).toBe(0)
    expect(lines).toEqual(["up to date"])
  })

  it("migrates a new database without a backup and prints the setup code", async () => {
    const file = path.join(dir, "new.db")
    expect(await migrateDatabase({ file, log })).toBe(0)
    expect(existsSync(path.join(dir, "backups"))).toBe(false)
    const out = lines.join("\n").split("\n")
    const at = out.findIndex((l) => l.includes("first-run setup"))
    expect(at).toBeGreaterThan(0)
    expect(out.slice(at, at + 5).join("\n")).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)
  })

  it("keeps the holiday surcharge of existing installs; the City of Fribourg becomes canton FR", () => {
    expect(settingsAfter("25").rows).toEqual([
      { key: "holiday_work_surcharge_mode", value: '"time_credit"' },
      { key: "holiday_work_surcharge_percent", value: "25" },
    ])
    const none = settingsAfter(null)
    expect(none.rows).toEqual([{ key: "holiday_work_surcharge_percent", value: "0" }])
    // same dates as before: the canton's commune days stay ticked
    expect(none.cal).toEqual({
      r: "CH-FR",
      d: '["Corpus Christi","Assumption Day","All Saints\' Day","Immaculate Conception"]',
    })
  })

  it("skips the backup on request", async () => {
    const file = path.join(dir, "rt.db")
    olderDatabase(file, true)
    expect(await migrateDatabase({ file, backup: false, log })).toBe(0)
    expect(existsSync(path.join(dir, "backups"))).toBe(false)
  })

  it("refuses a database migrated by a newer version without changing it", async () => {
    const file = path.join(dir, "rt.db")
    const sqlite = openSqlite(file)
    runMigrations(createDb(sqlite))
    sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 4102444800000)").run()
    sqlite.pragma("wal_checkpoint(TRUNCATE)")
    sqlite.close()
    const before = sha(file)
    await expect(migrateDatabase({ file, log })).rejects.toThrow(/newer RESORIXtrack/)
    expect(sha(file)).toBe(before)
  })
})
