import "@tanstack/react-start/server-only"
/**
 * SQLite connection (better-sqlite3, synchronous) and Drizzle instance.
 *
 * better-sqlite3 is synchronous, so a service function that runs inside `db.transaction(...)`
 * must not `await` in between – keep business logic synchronous and do I/O (mail, files) after commit.
 */
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { z } from "zod"
import { env } from "../env"
import * as schema from "./schema"

export type DB = ReturnType<typeof createDb>

export function openSqlite(file: string): Database.Database {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true })
  const sqlite = new Database(file)
  // before any pragma that writes: a refused database must stay byte-identical
  try {
    assertUpgradable(sqlite, MIGRATIONS_DIR)
  } catch (err) {
    sqlite.close()
    throw err
  }
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("busy_timeout = 5000")
  sqlite.pragma("synchronous = NORMAL")
  return sqlite
}

export function createDb(sqlite: Database.Database) {
  return drizzle({ client: sqlite, schema, casing: "snake_case" })
}

export const MIGRATIONS_DIR = path.resolve(process.env.MIGRATIONS_DIR ?? "drizzle")

/** The database cannot be opened by this build (upgraded by a newer version). */
export class DatabaseVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DatabaseVersionError"
  }
}

export interface MigrationStatus {
  /** No `__drizzle_migrations` table yet (new database). */
  fresh: boolean
  /** Tags of migrations this build would apply. */
  pending: string[]
  /** `created_at` of applied migrations this build does not know (a newer version ran). */
  unknown: number[]
}

const Journal = z.object({ entries: z.array(z.object({ tag: z.string(), when: z.number() })) })

function journal(folder: string): { tag: string; when: number }[] {
  return Journal.parse(JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"))).entries
}

const hasTable = (sqlite: Database.Database, name: string) =>
  Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))

/** Read-only comparison of the applied migrations with the ones shipped in `folder`. */
export function migrationStatus(sqlite: Database.Database, folder = MIGRATIONS_DIR): MigrationStatus {
  const known = journal(folder)
  if (!hasTable(sqlite, "__drizzle_migrations")) return { fresh: true, pending: known.map((m) => m.tag), unknown: [] }
  const applied = sqlite
    .prepare<[], { at: number }>("SELECT CAST(created_at AS INTEGER) AS at FROM __drizzle_migrations")
    .all()
    .map((r) => r.at)
  const whens = new Set(known.map((m) => m.when))
  const last = applied.length ? Math.max(...applied) : null
  return {
    fresh: false,
    // the drizzle migrator applies every migration newer than the last applied one
    pending: known.filter((m) => last == null || m.when > last).map((m) => m.tag),
    unknown: applied.filter((at) => !whens.has(at)),
  }
}

/** Refuse a database migrated by a newer build. Reads only. */
export function assertUpgradable(sqlite: Database.Database, folder = MIGRATIONS_DIR): void {
  const { unknown } = migrationStatus(sqlite, folder)
  if (unknown.length)
    throw new DatabaseVersionError(
      `${sqlite.name} was upgraded by a newer RESORIXtrack (${unknown.length} unknown migration(s)). ` +
        "Downgrades are not supported: install the newer version or restore a backup made with this one.",
    )
}

export function runMigrations(database: DB, folder = MIGRATIONS_DIR): void {
  assertUpgradable(database.$client, folder)
  migrate(database, { migrationsFolder: folder })
}

type Holder = { sqlite: Database.Database; db: DB }

declare global {
  // one connection per process, also across dev-server module reloads
  var __rtDb: Holder | undefined
}

function holder(): Holder {
  if (!globalThis.__rtDb) {
    const sqlite = openSqlite(env.databasePath)
    const database = createDb(sqlite)
    runMigrations(database)
    globalThis.__rtDb = { sqlite, db: database }
  }
  return globalThis.__rtDb
}

/** The process-wide database (lazily opened and migrated on first use). */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an empty proxy target: every property is read from the real database
export const db: DB = new Proxy({} as DB, {
  get: (_t, prop) => Reflect.get(holder().db, prop),
})
export function rawSqlite(): Database.Database {
  return holder().sqlite
}

/** Replace the process-wide database without migrating it (tests, `rt migrate`). */
export function setDatabase(sqlite: Database.Database): DB {
  const database = createDb(sqlite)
  globalThis.__rtDb = { sqlite, db: database }
  return database
}

export { schema }
