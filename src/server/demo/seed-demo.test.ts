import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { and, eq, isNull } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createDb, db, openSqlite, rawSqlite, runMigrations, setDatabase } from "@/server/db"
import * as s from "@/server/db/schema"
import { verifyPassword } from "@/server/password"
import { SEAL_VERSION, verifyUserChain } from "@/server/services/seals"
import { freeze } from "@/server/time"
import { formatAccounts, resetDevDatabase, seedDemo } from "."
import { emailOf } from "./data"

const TABLES = [
  "users",
  "account",
  "teams",
  "team_leads",
  "work_schedules",
  "projects",
  "time_entries",
  "absences",
  "balance_adjustments",
  "month_signoffs",
  "revisions",
  "notifications",
  "holidays",
]
const counts = () =>
  Object.fromEntries(
    TABLES.map((t) => [t, rawSqlite().prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${t}`).get()?.n]),
  )
const user = (local: string) =>
  db
    .select()
    .from(s.users)
    .where(eq(s.users.email, emailOf(local)))
    .get()!

function open(file: string) {
  const sqlite = openSqlite(file)
  runMigrations(createDb(sqlite))
  setDatabase(sqlite)
  return sqlite
}

beforeEach(() => freeze("2026-11-06T13:00:00Z"))

describe("seed-demo", () => {
  it("creates the demo company", async () => {
    const result = await seedDemo()
    expect(result.created).toBe(true)
    const c = counts()
    expect(c).toMatchObject({
      users: 12,
      account: 12,
      teams: 3,
      team_leads: 4,
      work_schedules: 12,
      projects: 6,
      balance_adjustments: 4,
      month_signoffs: 4,
    })
    expect(c.time_entries).toBeGreaterThan(1200) // a morning and an afternoon: the gap is the break
    const withProject = rawSqlite()
      .prepare<[], { n: number }>("SELECT count(*) AS n FROM time_entries WHERE project_id IS NOT NULL")
      .get()!.n
    expect(withProject / c.time_entries!).toBeGreaterThan(0.9)
    expect(c.holidays).toBeGreaterThan(0)

    const admin = user("admin")
    expect(admin).toMatchObject({ role: "admin", capabilities: [], emailVerified: true })
    expect(user("nina.graf").capabilities).toEqual(["hr", "projects"])
    const hash = db.select().from(s.account).where(eq(s.account.userId, admin.id)).get()!.password!
    expect(await verifyPassword({ hash, password: "demo" })).toBe(true)
    expect(
      db
        .select()
        .from(s.workSchedules)
        .where(eq(s.workSchedules.userId, user("noah.favre").id))
        .get(),
    ).toMatchObject({ pensumPercent: 60, minutesWed: 504, minutesThu: 0 })
    expect(db.select().from(s.teamLeads).where(eq(s.teamLeads.role, "deputy")).get()).toMatchObject({
      userId: user("sofia.rossi").id,
      validFrom: "2026-11-06",
      validTo: "2026-11-20",
    })

    const runningEntries = db.select().from(s.timeEntries).where(isNull(s.timeEntries.endAt)).all()
    expect(runningEntries.map((e) => [e.userId, e.startAt])).toEqual([
      [user("tim.baumann").id, "2026-11-06T07:00:00.000000Z"],
    ])
    const statuses = new Set(
      db
        .select()
        .from(s.absences)
        .all()
        .map((a) => a.status),
    )
    expect(statuses).toEqual(new Set(["approved", "pending"]))

    const signed = db.select().from(s.monthSignoffs).all()
    expect(new Set(signed.map((r) => r.month))).toEqual(new Set(["2026-10"]))
    expect(signed.every((r) => r.sealVersion === SEAL_VERSION)).toBe(true)
    for (const r of signed) expect(verifyUserChain(r.userId)).toEqual({})
    const anna = user("anna.meier")
    expect(() =>
      db
        .insert(s.timeEntries)
        .values({ userId: anna.id, startAt: "2026-10-12T06:00:00.000000Z", endAt: "2026-10-12T07:00:00.000000Z" })
        .run(),
    ).toThrow(/period signed off/)
    expect(
      db
        .select()
        .from(s.revisions)
        .where(and(eq(s.revisions.subjectUserId, anna.id), eq(s.revisions.action, "update")))
        .all(),
    ).toHaveLength(1)

    const table = formatAccounts(result.accounts, "demo")
    expect(table).toContain("admin@example.nomail")
    expect(table.split("\n")).toHaveLength(12 + 4)
  })

  it("is idempotent", async () => {
    await seedDemo()
    const before = counts()
    const again = await seedDemo()
    expect(again.created).toBe(false)
    expect(counts()).toEqual(before)
  })

  describe("--reset", () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), "rt-demo-"))
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it("starts from an empty database and seeds the same company again", async () => {
      const file = path.join(dir, "resorixtrack.db")
      let sqlite = open(file)
      await seedDemo()
      const first = counts()
      const entries = db.select({ id: s.timeEntries.id, startAt: s.timeEntries.startAt }).from(s.timeEntries).all()
      sqlite.close()

      resetDevDatabase(file, path.join(dir, "attachments"))
      sqlite = open(file)
      expect(counts().users).toBe(0)
      expect((await seedDemo()).created).toBe(true)
      expect(counts()).toEqual(first)
      expect(db.select({ id: s.timeEntries.id, startAt: s.timeEntries.startAt }).from(s.timeEntries).all()).toEqual(
        entries,
      )
      sqlite.close()
    })
  })
})
