import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { zipSync } from "fflate"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeAdmin, makeUser } from "@/test/factories"
import { openSqlite, runMigrations, setDatabase } from "../db"
import { env } from "../env"
import { encryptBuffer } from "./backup-crypto"
import { createBackup, deleteBackup, listBackups, openBackup, restoreBackup, rotateBackups } from "./backups"
import { loadActor } from "./permissions"

let dir: string
const saved = { ...env }

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rt-backups-"))
  Object.assign(env, {
    dataDir: dir,
    backupsDir: path.join(dir, "backups"),
    attachmentsDir: path.join(dir, "attachments"),
    brandingDir: path.join(dir, "branding"),
    backupPassword: "test-backup-password",
  })
})
afterEach(() => {
  Object.assign(env, saved)
  rmSync(dir, { recursive: true, force: true })
})

const ORPHAN = "orphan-document-0001.pdf"

/** An installation to restore over: a database with one marker row and one document. */
function installation(name: string) {
  const root = path.join(dir, name)
  const target = path.join(root, "resorixtrack.db")
  mkdirSync(path.join(root, "attachments"), { recursive: true })
  writeFileSync(path.join(root, "attachments", ORPHAN), "sick note")
  const cur = new Database(target)
  cur.exec("CREATE TABLE marker (v TEXT); INSERT INTO marker VALUES ('before')")
  cur.close()
  const marker = () => {
    const d = new Database(target, { readonly: true })
    try {
      return d.prepare("SELECT name FROM sqlite_master WHERE name = 'marker'").get() != null
    } finally {
      d.close()
    }
  }
  const leftovers = () => readdirSync(root).filter((f) => f.includes("before-restore") || f.includes("restore-tmp"))
  const restore = (opened: Awaited<ReturnType<typeof openBackup>>) =>
    restoreBackup(opened, { databasePath: target, dataDir: root })
  return { root, marker, leftovers, restore }
}

async function backup(opts: Parameters<typeof createBackup>[0] = {}) {
  const info = await createBackup(opts)
  return openBackup(path.join(env.backupsDir, info.name), env.backupPassword)
}

describe("backups", () => {
  it("creates an encrypted backup that restores into a fresh database", async () => {
    makeUser({ name: "Anna Muster" })
    mkdirSync(env.brandingDir, { recursive: true })
    writeFileSync(path.join(env.brandingDir, "logo-dark.svg"), "<svg/>")
    const info = await createBackup({ label: "manual" })
    expect(info.name).toMatch(/^resorixtrack-\d{8}-\d{6}-manual\.zip\.enc$/)
    const file = path.join(env.backupsDir, info.name)
    expect(readFileSync(file).subarray(0, 4).toString()).toBe("RTBK")
    expect(readFileSync(file).includes(Buffer.from("Anna Muster"))).toBe(false)

    const opened = await openBackup(file, env.backupPassword)
    expect(opened.manifest.format).toBe(3)
    expect(Object.keys(opened.manifest.files)).toContain("branding/logo-dark.svg")

    const target = path.join(dir, "restore", "resorixtrack.db")
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, "")
    new Database(target).close()
    restoreBackup(opened, { databasePath: target, dataDir: path.join(dir, "restore") })
    const restored = new Database(target, { readonly: true })
    expect(restored.prepare("SELECT name FROM users").all()).toEqual([{ name: "Anna Muster" }])
    restored.close()
    expect(existsSync(path.join(dir, "restore", "branding", "logo-dark.svg"))).toBe(true)
  })

  it("restores a backup taken from a file database in WAL mode", async () => {
    const sqlite = openSqlite(path.join(dir, "live.db"))
    runMigrations(setDatabase(sqlite))
    makeUser({ name: "Walter Wal" })
    const info = await createBackup()
    const opened = await openBackup(path.join(env.backupsDir, info.name), env.backupPassword)
    const target = path.join(dir, "restored", "resorixtrack.db")
    restoreBackup(opened, { databasePath: target, dataDir: path.join(dir, "restored") })
    const restored = new Database(target, { readonly: true })
    expect(restored.prepare("SELECT name FROM users").all()).toEqual([{ name: "Walter Wal" }])
    restored.close()
    sqlite.close()
  })

  it("deletes the unencrypted copies of the replaced data after a restore, also older ones", async () => {
    makeUser({ name: "Anna Muster" })
    const opened = await backup() // with documents, of which there were none
    expect(opened.manifest.includeAttachments).toBe(true)
    const inst = installation("live")
    writeFileSync(path.join(inst.root, "resorixtrack.db.before-restore-20250101-000000"), "old")
    mkdirSync(path.join(inst.root, "attachments.before-restore-20250101-000000"))
    inst.restore(opened)
    expect(inst.marker()).toBe(false)
    expect(inst.leftovers()).toEqual([])
    expect(readdirSync(path.join(inst.root, "attachments"))).toEqual([])
  })

  it("keeps the documents when the backup was made without them", async () => {
    const opened = await backup({ includeAttachments: false })
    const inst = installation("live")
    inst.restore(opened)
    expect(inst.marker()).toBe(false)
    expect(readdirSync(path.join(inst.root, "attachments"))).toEqual([ORPHAN])
    expect(inst.leftovers()).toEqual([])
  })

  it("puts the database, documents and logos back when a restore fails", async () => {
    mkdirSync(env.brandingDir, { recursive: true })
    writeFileSync(path.join(env.brandingDir, "logo-dark.svg"), "<svg/>")
    const opened = await backup()
    const inst = installation("live")
    // a directory where the backup's logo goes makes the last step fail
    mkdirSync(path.join(inst.root, "branding", "logo-dark.svg"), { recursive: true })
    writeFileSync(path.join(inst.root, "branding", "logo-light.svg"), "<svg id='mine'/>")
    expect(() => inst.restore(opened)).toThrow()
    expect(inst.marker()).toBe(true)
    expect(readdirSync(path.join(inst.root, "attachments"))).toEqual([ORPHAN])
    expect(readFileSync(path.join(inst.root, "branding", "logo-light.svg"), "utf8")).toBe("<svg id='mine'/>")
    expect(inst.leftovers()).toEqual([])
  })

  it("refuses a wrong password", async () => {
    const info = await createBackup()
    await expect(openBackup(path.join(env.backupsDir, info.name), "another-password")).rejects.toThrow(
      /Wrong backup password/,
    )
  })

  it("refuses a RESORIXtrack 1.x backup", async () => {
    const v1zip = zipSync({
      "resorixtrack.db": Buffer.from("sqlite"),
      "manifest.json": Buffer.from(
        JSON.stringify({ app: "resorixtrack", version: "1.0.0", format: 2, encrypted: "RTBK1" }),
      ),
    })
    const file = path.join(dir, "resorixtrack-20260101-020000-auto.zip.enc")
    writeFileSync(file, await encryptBuffer(v1zip, env.backupPassword))
    await expect(openBackup(file, env.backupPassword)).rejects.toThrow(/1\.x/)
  })

  it("lists, rotates and deletes (administrators only)", async () => {
    const admin = loadActor(makeAdmin().id)
    const emp = loadActor(makeUser().id)
    mkdirSync(env.backupsDir, { recursive: true })
    for (const d of ["20260101", "20260102", "20260103"]) {
      const f = path.join(env.backupsDir, `resorixtrack-${d}-020000-auto.zip.enc`)
      writeFileSync(f, "x")
      utimesSync(f, new Date(), new Date())
    }
    writeFileSync(path.join(env.backupsDir, "resorixtrack-20251231-120000.zip.enc"), "x")
    writeFileSync(path.join(env.backupsDir, "evil.txt"), "x")
    expect(() => listBackups(emp)).toThrow(/Administrators only/)
    expect(listBackups(admin).map((b) => b.name)).toHaveLength(4)
    expect(rotateBackups(2)).toBe(1)
    expect(listBackups(admin).map((b) => b.kind)).toEqual(["auto", "auto", "manual"])
    expect(() => deleteBackup(admin, "../evil.txt")).toThrow(/not found/)
    deleteBackup(admin, "resorixtrack-20251231-120000.zip.enc")
    expect(listBackups(admin)).toHaveLength(2)
  })
})
