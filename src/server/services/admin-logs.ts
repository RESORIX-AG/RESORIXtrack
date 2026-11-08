/**
 * Administrator views of the change log (revisions) and the sign-in log, read newest first in pages that
 * continue from a cursor (the last row's instant and id), so a page costs the same however deep the reader
 * scrolls. Administrators without the HR capability see no time data, not even in the change log.
 */
import { aliasedTable, and, count, desc, eq, gte, inArray, like, lt, or, type SQL } from "drizzle-orm"
import type { SQLiteColumn } from "drizzle-orm/sqlite-core"
import { db } from "../db"
import { loginAttempts, revisions, users } from "../db/schema"
import { iso, rangeBoundsUtc } from "../time"
import { type Actor, requireAdmin } from "./permissions"
import { getSetting } from "./settings"

export const ADMIN_AUDIT_ENTITIES = [
  "user",
  "team",
  "team_lead",
  "schedule",
  "entitlement",
  "project",
  "api_token",
  "holiday",
  "signoff",
]
export const ALL_AUDIT_ENTITIES = [
  ...ADMIN_AUDIT_ENTITIES,
  "time_entry",
  "absence",
  "adjustment",
  "attachment",
  "work_log",
]

export interface CursorPage {
  /** where the page starts; null for the newest rows */
  cursor?: string | null
  limit?: number
}

export interface AuditFilters extends CursorPage {
  userId?: number | null
  entity?: string | null
  action?: string | null
  from?: string | null
  to?: string | null
}

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)~(\d+)$/

/** Rows older than the cursor (`<instant>~<id>`); an unreadable cursor starts from the newest row. */
function olderThan(at: SQLiteColumn, id: SQLiteColumn, cursor: string | null | undefined): SQL | undefined {
  const m = cursor ? CURSOR_RE.exec(cursor) : null
  if (!m) return undefined
  return or(lt(at, m[1]), and(eq(at, m[1]), lt(id, Number(m[2]))))
}

function pageLimit(limit: number | undefined): number {
  return Math.min(200, Math.max(10, limit ?? 100))
}

/** One row more than the page is read: when it exists, the last row of the page is the next cursor. */
function cut<T>(rows: T[], limit: number, key: (row: T) => { at: string; id: number }) {
  if (rows.length <= limit) return { rows, nextCursor: null }
  const page = rows.slice(0, limit)
  const last = key(page[limit - 1])
  return { rows: page, nextCursor: `${last.at}~${last.id}` }
}

function bounds(from?: string | null, to?: string | null): SQL[] {
  const tz = getSetting("default_timezone")
  const out: SQL[] = []
  if (from) out.push(gte(revisions.at, rangeBoundsUtc(from, from, tz)[0]))
  if (to) out.push(lt(revisions.at, rangeBoundsUtc(to, to, tz)[1]))
  return out
}

export function auditLog(actor: Actor, f: AuditFilters = {}) {
  requireAdmin(actor)
  const limit = pageLimit(f.limit)
  const allowed = actor.isHr ? ALL_AUDIT_ENTITIES : ADMIN_AUDIT_ENTITIES
  const conds: SQL[] = [inArray(revisions.entity, f.entity && allowed.includes(f.entity) ? [f.entity] : allowed)]
  if (f.userId) conds.push(eq(revisions.subjectUserId, f.userId))
  if (f.action) conds.push(eq(revisions.action, f.action))
  conds.push(...bounds(f.from, f.to))
  const where = and(...conds)
  // the size is counted once, for the first page
  const total = f.cursor ? null : (db.select({ n: count() }).from(revisions).where(where).get()?.n ?? 0)
  const actorU = aliasedTable(users, "actor_u")
  const subjectU = aliasedTable(users, "subject_u")
  const rows = db
    .select({ r: revisions, actorName: actorU.name, subjectName: subjectU.name })
    .from(revisions)
    .leftJoin(actorU, eq(actorU.id, revisions.actorId))
    .leftJoin(subjectU, eq(subjectU.id, revisions.subjectUserId))
    .where(and(where, olderThan(revisions.at, revisions.id, f.cursor)))
    .orderBy(desc(revisions.at), desc(revisions.id))
    .limit(limit + 1)
    .all()
  const { rows: page, nextCursor } = cut(rows, limit, ({ r }) => r)
  return {
    total,
    nextCursor,
    items: page.map(({ r, actorName, subjectName }) => ({
      id: r.id,
      at: iso(r.at),
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      actor: actorName,
      subject: subjectName,
      subjectUserId: r.subjectUserId,
      reason: r.reason,
      source: r.source,
      changed:
        r.before && r.after
          ? Object.keys(r.after)
              .filter((k) => JSON.stringify(r.before![k]) !== JSON.stringify(r.after![k]))
              .sort()
          : [],
      before: r.before,
      after: r.after,
    })),
  }
}
export type AuditItem = ReturnType<typeof auditLog>["items"][number]

export interface LoginFilters extends CursorPage {
  q?: string | null
  success?: boolean | null
  from?: string | null
  to?: string | null
}

export function loginLog(actor: Actor, f: LoginFilters = {}) {
  requireAdmin(actor)
  const limit = pageLimit(f.limit)
  const tz = getSetting("default_timezone")
  const conds: SQL[] = []
  if (f.q?.trim()) conds.push(like(loginAttempts.email, `%${f.q.trim().toLowerCase().replace(/[%_]/g, "")}%`))
  if (f.success != null) conds.push(eq(loginAttempts.success, f.success))
  if (f.from) conds.push(gte(loginAttempts.at, rangeBoundsUtc(f.from, f.from, tz)[0]))
  if (f.to) conds.push(lt(loginAttempts.at, rangeBoundsUtc(f.to, f.to, tz)[1]))
  const where = conds.length ? and(...conds) : undefined
  const total = f.cursor ? null : (db.select({ n: count() }).from(loginAttempts).where(where).get()?.n ?? 0)
  const rows = db
    .select({ a: loginAttempts, name: users.name })
    .from(loginAttempts)
    .leftJoin(users, eq(users.id, loginAttempts.userId))
    .where(and(where, olderThan(loginAttempts.at, loginAttempts.id, f.cursor)))
    .orderBy(desc(loginAttempts.at), desc(loginAttempts.id))
    .limit(limit + 1)
    .all()
  const { rows: page, nextCursor } = cut(rows, limit, ({ a }) => a)
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const failed24h = f.cursor
    ? null
    : (db
        .select({ n: count() })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.success, false), gte(loginAttempts.at, since.replace(/\.(\d{3})Z$/, ".$1000Z"))))
        .get()?.n ?? 0)
  return {
    total,
    nextCursor,
    failed24h,
    items: page.map(({ a, name }) => ({
      id: a.id,
      at: iso(a.at),
      email: a.email,
      userId: a.userId,
      name,
      ip: a.ip,
      userAgent: a.userAgent,
      success: a.success,
      reason: a.reason,
    })),
  }
}
export type LoginItem = ReturnType<typeof loginLog>["items"][number]
