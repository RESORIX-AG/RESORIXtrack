/**
 * Session limits on top of Better Auth (as in v1): every session ends SESSION_ABSOLUTE_DAYS after sign-in,
 * however often it is used; a session without "keep me signed in" (`session.short`, set when it is created)
 * ends after SESSION_SHORT_IDLE_HOURS without activity, and we slide its `updatedAt` and `expiresAt` here.
 */
import { eq } from "drizzle-orm"
import { db } from "./db"
import { session } from "./db/schema"
import { env } from "./env"

const HOUR_MS = 3_600_000
/** Write the activity stamp at most this often (keeps SQLite writes low). */
const SLIDE_EVERY_MS = 5 * 60_000

export type SessionVerdict = "none" | "ok" | "revoked"

/** Better Auth gives a session without "keep me signed in" one day; remembered ones SESSION_REMEMBER_DAYS. */
export function isShortSession(s: { createdAt: Date; expiresAt: Date }): boolean {
  if (env.sessionRememberDays <= 1) return false
  return s.expiresAt.getTime() - s.createdAt.getTime() <= 24 * HOUR_MS + 60_000
}

export function applySessionPolicy(token: string, now = Date.now()): SessionVerdict {
  const row = db.select().from(session).where(eq(session.token, token)).get()
  if (!row) return "none"
  const { short } = row
  const absoluteEnd = row.createdAt.getTime() + env.sessionAbsoluteDays * 24 * HOUR_MS
  const idleEnd = row.updatedAt.getTime() + env.sessionShortIdleHours * HOUR_MS
  if (now >= absoluteEnd || (short && now >= idleEnd)) {
    db.delete(session).where(eq(session.id, row.id)).run()
    return "revoked"
  }
  if (short && now - row.updatedAt.getTime() >= SLIDE_EVERY_MS) {
    const expiresAt = new Date(Math.min(now + env.sessionShortIdleHours * HOUR_MS, absoluteEnd))
    db.update(session)
      .set({ updatedAt: new Date(now), expiresAt })
      .where(eq(session.id, row.id))
      .run()
  }
  return "ok"
}
