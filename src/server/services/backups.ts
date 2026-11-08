/**
 * Encrypted backups: a ZIP with a consistent snapshot of the SQLite database, the live attachments, the
 * branding files and a manifest (version, checksums), encrypted with BACKUP_PASSWORD (RTBK1, see
 * backup-crypto.ts). The database snapshot is taken in memory and the ZIP is streamed straight into the
 * encryptor, so no unencrypted archive is ever written to disk. Restore is CLI-only (app stopped).
 */
import { createHash } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { unzipSync, Zip, ZipDeflate, ZipPassThrough } from "fflate"
import { z } from "zod"
import { db, rawSqlite } from "../db"
import { attachments } from "../db/schema"
import { env } from "../env"
import { NotFound, Validation } from "../errors"
import { iso } from "../time"
import { decryptFileToBuffer, Encryptor, isEncryptedFile, MIN_BACKUP_PASSWORD_LENGTH } from "./backup-crypto"
import type { Actor } from "./permissions"
import { requireAdmin } from "./permissions"

export const SUFFIX = ".zip.enc"
const NAME_RE = /^resorixtrack-\d{8}-\d{6}(-[a-z0-9]+)?\.zip\.enc$/
const DB_ENTRY = "resorixtrack.db"
const FORMAT = 3 // v1 wrote format 2 (Flask schema)
const BRANDING_RE = /^logo-(dark|light)\.(svg|png|webp)$/
const ATTACHMENT_RE = /^[A-Za-z0-9_-]{16,128}(\.[a-z0-9]{1,8})?$/

export interface BackupInfo {
  name: string
  size: number
  createdAt: string
  kind: "auto" | "premigrate" | "manual"
}

const FileSums = z.record(z.string(), z.object({ size: z.number(), sha256: z.string() }))
const ManifestSchema = z.object({
  app: z.literal("resorixtrack"),
  format: z.number(),
  version: z.string(),
  createdAt: z.string(),
  includeAttachments: z.boolean(),
  encrypted: z.literal("RTBK1"),
  files: FileSums,
})
export type Manifest = z.infer<typeof ManifestSchema>

/** Any manifest this or an earlier version wrote (1.x: snake_case, no checksums). */
const StoredManifest = z.looseObject({
  app: z.string().optional(),
  format: z.number().optional(),
  version: z.string().optional(),
  createdAt: z.string().optional(),
  created_at: z.string().optional(),
  files: FileSums.optional(),
})
type StoredManifest = z.infer<typeof StoredManifest>

function readManifest(raw: Uint8Array): StoredManifest {
  try {
    return StoredManifest.parse(JSON.parse(Buffer.from(raw).toString("utf8")))
  } catch {
    throw new Validation("Not a RESORIXtrack backup archive")
  }
}

const PackageJson = z.object({ version: z.string().optional() })

export function appVersion(): string {
  try {
    return PackageJson.parse(JSON.parse(readFileSync(path.resolve("package.json"), "utf8"))).version ?? "2"
  } catch {
    return "2"
  }
}

export function backupPassword(): string {
  const pw = env.backupPassword
  if (!pw || pw.length < MIN_BACKUP_PASSWORD_LENGTH || pw.startsWith("change-me"))
    throw new Validation("BACKUP_PASSWORD is not configured on the server (at least 12 characters)", {
      code: "backup_password_missing",
    })
  return pw
}

function backupsDir(): string {
  mkdirSync(env.backupsDir, { recursive: true, mode: 0o700 })
  return env.backupsDir
}

const pad2 = (n: number) => String(n).padStart(2, "0")

function stamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`
}

function describeBackup(file: string): BackupInfo {
  const st = statSync(file)
  const name = path.basename(file)
  const kind = name.endsWith(`-auto${SUFFIX}`)
    ? "auto"
    : name.endsWith(`-premigrate${SUFFIX}`)
      ? "premigrate"
      : "manual"
  return { name, size: st.size, createdAt: iso(st.mtime.toISOString()), kind }
}

/**
 * A serialized WAL database still says "WAL" in its header (bytes 18/19) and cannot be opened without its
 * -wal/-shm files; switch the image to the rollback journal (the app turns WAL on again when it opens it).
 */
function rollbackJournal(image: Buffer): Buffer {
  if (image.length > 19 && image[18] === 2) {
    image[18] = 1
    image[19] = 1
  }
  return image
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")

/** Create an encrypted backup in DATA_DIR/backups. Async (streams), never inside a transaction. */
export async function createBackup(opts: { includeAttachments?: boolean; label?: string } = {}): Promise<BackupInfo> {
  const includeAttachments = opts.includeAttachments ?? true
  const password = backupPassword()
  const now = new Date()
  const suffix = opts.label
    ? `-${opts.label
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 16)}`
    : ""
  const name = `resorixtrack-${stamp(now)}${suffix}${SUFFIX}`
  const dest = path.join(backupsDir(), name)
  const tmp = `${dest}.part`

  // consistent snapshot: serialize() reads the whole database in one go (synchronous, in memory)
  const dbImage = rollbackJournal(rawSqlite().serialize())
  const entries: { name: string; data: Uint8Array; compress: boolean }[] = [
    { name: DB_ENTRY, data: dbImage, compress: true },
  ]
  if (includeAttachments && existsSync(env.attachmentsDir)) {
    const live = db
      .select({ s: attachments.storageName })
      .from(attachments)
      .where(eq(attachments.isDeleted, false))
      .all()
    for (const { s } of live.sort((a, b) => a.s.localeCompare(b.s))) {
      const file = path.join(env.attachmentsDir, s)
      if (ATTACHMENT_RE.test(s) && existsSync(file))
        entries.push({ name: `attachments/${s}`, data: readFileSync(file), compress: false })
    }
  }
  if (existsSync(env.brandingDir)) {
    for (const f of readdirSync(env.brandingDir)
      .filter((logo) => BRANDING_RE.test(logo))
      .sort())
      entries.push({ name: `branding/${f}`, data: readFileSync(path.join(env.brandingDir, f)), compress: true })
  }
  const manifest: Manifest = {
    app: "resorixtrack",
    format: FORMAT,
    version: appVersion(),
    createdAt: iso(now.toISOString()),
    includeAttachments,
    encrypted: "RTBK1",
    files: Object.fromEntries(entries.map((e) => [e.name, { size: e.data.length, sha256: sha256(e.data) }])),
  }
  entries.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)), compress: true })

  const zipOut = new Readable({ read() {} })
  const zip = new Zip((err, chunk, final) => {
    if (err) zipOut.destroy(err)
    else {
      zipOut.push(Buffer.from(chunk))
      if (final) zipOut.push(null)
    }
  })
  try {
    const done = pipeline(zipOut, new Encryptor(password), createWriteStream(tmp, { mode: 0o600 }))
    for (const e of entries) {
      const f = e.compress ? new ZipDeflate(e.name, { level: 6 }) : new ZipPassThrough(e.name)
      zip.add(f)
      f.push(e.data, true)
    }
    zip.end()
    await done
    renameSync(tmp, dest)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  return describeBackup(dest)
}

export function listBackups(actor: Actor | null): BackupInfo[] {
  if (actor) requireAdmin(actor)
  if (!existsSync(env.backupsDir)) return []
  return readdirSync(env.backupsDir)
    .filter((f) => NAME_RE.test(f))
    .sort()
    .toReversed()
    .map((f) => describeBackup(path.join(env.backupsDir, f)))
}

export function backupPath(name: string): string {
  if (!NAME_RE.test(name ?? "")) throw new NotFound("Backup not found")
  const file = path.join(env.backupsDir, name)
  if (!existsSync(file)) throw new NotFound("Backup not found")
  return file
}

export function deleteBackup(actor: Actor, name: string): void {
  requireAdmin(actor)
  unlinkSync(backupPath(name))
}

/** Keep the newest `keep` automatic backups (BACKUP_KEEP); manual ones are never rotated. */
export function rotateBackups(keep = env.backupKeep): number {
  if (!existsSync(env.backupsDir)) return 0
  const auto = readdirSync(env.backupsDir)
    .filter((f) => NAME_RE.test(f) && f.endsWith(`-auto${SUFFIX}`))
    .sort()
    .toReversed()
  let removed = 0
  // the newest backup always stays
  for (const f of auto.slice(Math.max(1, keep))) {
    unlinkSync(path.join(env.backupsDir, f))
    removed++
  }
  return removed
}

// ------------------------------------------------------------------ restore (CLI only)

export interface OpenedBackup {
  manifest: Manifest
  files: Record<string, Uint8Array>
}

/** Decrypt (in memory), unzip and verify a backup. */
export async function openBackup(file: string, password: string): Promise<OpenedBackup> {
  if (!isEncryptedFile(file)) throw new Validation("Not an encrypted RESORIXtrack backup (.zip.enc)")
  const { data } = await decryptFileToBuffer(file, password)
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Validation("The backup archive is damaged")
  }
  const rawManifest = files["manifest.json"]
  if (!rawManifest || !files[DB_ENTRY]) throw new Validation("Not a RESORIXtrack backup archive")
  const stored = readManifest(rawManifest)
  if (stored.app !== "resorixtrack") throw new Validation("Not a RESORIXtrack backup archive")
  if ((stored.format ?? 0) < FORMAT || (stored.version ?? "").startsWith("1."))
    throw new Validation("This backup is from RESORIXtrack 1.x and cannot be restored")
  const parsed = ManifestSchema.safeParse(stored)
  if (!parsed.success) throw new Validation("Not a RESORIXtrack backup archive")
  const manifest = parsed.data
  for (const [name, meta] of Object.entries(manifest.files)) {
    const f = files[name]
    if (!f || f.length !== meta.size || sha256(f) !== meta.sha256) throw new Validation(`Checksum mismatch: ${name}`)
  }
  return { manifest, files }
}

export interface ExtractResult {
  manifest: StoredManifest
  written: string[]
  skipped: string[]
  /** Checksums were in the manifest (RESORIXtrack 2) and all matched. */
  verified: boolean
}

const safeEntry = (name: string) =>
  /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name) && !name.includes("..")

/**
 * Decrypt (in memory) a backup and write its files into `outDir` (new or empty). Nothing is written anywhere
 * else, and the decrypted ZIP itself never touches the disk.
 */
export async function extractBackup(file: string, password: string, outDir: string): Promise<ExtractResult> {
  if (!isEncryptedFile(file)) throw new Validation("Not an encrypted RESORIXtrack backup (.zip.enc)")
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Validation(`${outDir} is not empty`)
  const { data } = await decryptFileToBuffer(file, password)
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Validation("The backup archive is damaged")
  }
  const raw = files["manifest.json"]
  if (!raw) throw new Validation("Not a RESORIXtrack backup archive")
  const manifest = readManifest(raw)
  const sums = manifest.files ?? {}
  for (const [name, meta] of Object.entries(sums)) {
    const f = files[name]
    if (!f || f.length !== meta.size || sha256(f) !== meta.sha256) throw new Validation(`Checksum mismatch: ${name}`)
  }
  mkdirSync(outDir, { recursive: true, mode: 0o700 })
  const written: string[] = []
  const skipped: string[] = []
  for (const [name, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (name.endsWith("/")) continue
    if (!safeEntry(name)) {
      skipped.push(name)
      continue
    }
    const dest = path.join(outDir, name)
    mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
    writeFileSync(dest, content, { mode: 0o600 })
    written.push(name)
  }
  return { manifest, written, skipped, verified: Object.keys(sums).length > 0 }
}

export interface RestoreResult {
  manifest: Manifest
  attachments: number
}

function checkedImage(opened: OpenedBackup): Buffer {
  const image = rollbackJournal(Buffer.from(opened.files[DB_ENTRY]))
  const check = new Database(image)
  try {
    const ok = check.pragma("integrity_check", { simple: true })
    if (ok !== "ok") throw new Validation("The database in the backup failed the integrity check")
    const hasMigrations = check
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get()
    if (!hasMigrations) throw new Validation("The backup does not contain a RESORIXtrack 2 database")
  } finally {
    check.close()
  }
  return image
}

const ASIDE = ".before-restore-"

/** Move `target` to `<target>.before-restore-<stamp>`; null when there is nothing to move. */
function setAside(target: string, at: string): string | null {
  if (!existsSync(target)) return null
  const aside = `${target}${ASIDE}${at}`
  renameSync(target, aside)
  return aside
}

/** Delete every set-aside copy of `target`, also those an earlier release left behind. */
function removeSetAside(target: string): void {
  const dir = path.dirname(target)
  if (!existsSync(dir)) return
  const prefix = `${path.basename(target)}${ASIDE}`
  for (const f of readdirSync(dir).filter((name) => name.startsWith(prefix)))
    rmSync(path.join(dir, f), { recursive: true, force: true })
}

function putBack(target: string, aside: string | null, existed: boolean): void {
  if (aside) {
    rmSync(target, { recursive: true, force: true })
    renameSync(aside, target)
  } else if (!existed) rmSync(target, { recursive: true, force: true })
}

function logoFiles(brandDir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  if (!existsSync(brandDir)) return out
  for (const f of readdirSync(brandDir, { withFileTypes: true }))
    if (f.isFile() && BRANDING_RE.test(f.name)) out.set(f.name, readFileSync(path.join(brandDir, f.name)))
  return out
}

function replaceLogos(brandDir: string, logos: Map<string, Uint8Array>): void {
  mkdirSync(brandDir, { recursive: true })
  for (const f of logoFiles(brandDir).keys()) unlinkSync(path.join(brandDir, f))
  for (const [name, data] of logos) writeFileSync(path.join(brandDir, name), data)
}

function writeAttachments(attDir: string, files: Record<string, Uint8Array>): number {
  mkdirSync(attDir, { recursive: true })
  let count = 0
  for (const [name, data] of Object.entries(files)) {
    const att = name.match(/^attachments\/([^/]+)$/)
    if (att && ATTACHMENT_RE.test(att[1])) {
      writeFileSync(path.join(attDir, att[1]), data, { mode: 0o600 })
      count++
    }
  }
  return count
}

/**
 * Replace the database (and attachments/branding) with the backup's. The app must be stopped. The current
 * database and documents are unencrypted, so they are set aside only while the restore runs: deleted when it
 * succeeds, put back when it fails. Documents stay as they are when the backup was made without them.
 */
export function restoreBackup(
  opened: OpenedBackup,
  opts: { databasePath?: string; dataDir?: string } = {},
): RestoreResult {
  const dbPath = opts.databasePath ?? env.databasePath
  const dataDir = opts.dataDir ?? env.dataDir
  const attDir = path.join(dataDir, "attachments")
  const brandDir = path.join(dataDir, "branding")
  const withDocuments = opened.manifest.includeAttachments
  const image = checkedImage(opened)
  const logos = new Map(
    Object.entries(opened.files)
      .filter(([n]) => n.startsWith("branding/") && BRANDING_RE.test(n.slice(9)))
      .map(([n, data]) => [n.slice(9), data]),
  )

  mkdirSync(path.dirname(dbPath), { recursive: true })
  const had = { db: existsSync(dbPath), att: existsSync(attDir) }
  const previousLogos = logoFiles(brandDir)
  const at = stamp(new Date())
  let dbAside: string | null = null
  let attAside: string | null = null
  let count = 0
  try {
    if (had.db) {
      const cur = new Database(dbPath)
      try {
        cur.pragma("wal_checkpoint(TRUNCATE)")
      } finally {
        cur.close()
      }
    }
    for (const ext of ["-wal", "-shm"]) rmSync(`${dbPath}${ext}`, { force: true })
    dbAside = setAside(dbPath, at)
    writeFileSync(`${dbPath}.restore-tmp`, image, { mode: 0o600 })
    renameSync(`${dbPath}.restore-tmp`, dbPath)
    // documents newer than the backup (or purged since) must not stay around without a row
    if (withDocuments) {
      attAside = setAside(attDir, at)
      count = writeAttachments(attDir, opened.files)
    }
    replaceLogos(brandDir, logos)
  } catch (err) {
    rmSync(`${dbPath}.restore-tmp`, { force: true })
    putBack(dbPath, dbAside, had.db)
    if (withDocuments) putBack(attDir, attAside, had.att)
    replaceLogos(brandDir, previousLogos)
    throw err
  }
  removeSetAside(dbPath)
  removeSetAside(attDir)
  return { manifest: opened.manifest, attachments: count }
}
