/** Security log of sign-in attempts (successful and failed). Never stores passwords or tokens. */
import { and, count, desc, eq, gte, ne, notInArray, type SQL } from "drizzle-orm"
import { clientIp } from "../client-ip"
import { db } from "../db"
import { type LoginAttempt, loginAttempts, users } from "../db/schema"
import { env } from "../env"
import { fmtInstant, nowInstant } from "../time"

/** Unknown addresses are stored masked: people regularly type their password into the email field. */
function maskUnknown(email: string): string {
  const [local, domain] = email.split("@")
  return domain ? `${local.slice(0, 2)}***@${domain}` : `${email.slice(0, 2)}***`
}

const userIdByEmail = (email: string) =>
  email ? (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()?.id ?? null) : null

/** How an attempt with this email is stored: as typed for a known person, masked otherwise. */
function storedEmail(email: string, userId: number | null): string {
  return (userId != null ? email : maskUnknown(email)).slice(0, 254)
}

export function recordLoginAttempt(opts: {
  email: string
  userId?: number | null
  success: boolean
  reason: string
  headers?: Headers | null
}): void {
  const userId = opts.userId ?? userIdByEmail(opts.email)
  const reason = userId == null && opts.reason === "invalid_password" ? "unknown_user" : opts.reason
  db.insert(loginAttempts)
    .values({
      email: storedEmail(opts.email, userId),
      userId,
      ip: clientIp(opts.headers),
      userAgent: (opts.headers?.get("user-agent") ?? "").slice(0, 300),
      success: opts.success,
      reason,
    })
    .run()
}

const NOT_COUNTED = ["throttled", "reset_requested", "setup_code_ok"]

function failuresSince(since: string, where: SQL | undefined): number {
  return (
    db
      .select({ n: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.success, false),
          notInArray(loginAttempts.reason, NOT_COUNTED),
          gte(loginAttempts.at, since),
          where,
        ),
      )
      .get()?.n ?? 0
  )
}

function windowStart(minutes: number): string {
  return fmtInstant(nowInstant().subtract({ minutes }))
}

/**
 * v1 throttle: block an (email, IP) pair after LOGIN_MAX_FAILURES failures in the window, with wider
 * ceilings per email (x5, distributed spraying) and per IP (x4). Counts failures, not requests, so an
 * office behind one address is not locked out by successful sign-ins.
 */
export function loginThrottled(email: string, headers: Headers | null | undefined): boolean {
  const since = windowStart(env.loginWindowMinutes)
  const limit = env.loginMaxFailures
  const ip = clientIp(headers)
  return (
    failuresSince(since, and(eq(loginAttempts.email, email), eq(loginAttempts.ip, ip))) >= limit ||
    failuresSince(since, eq(loginAttempts.email, email)) >= limit * 5 ||
    (ip !== "" && failuresSince(since, eq(loginAttempts.ip, ip)) >= limit * 4)
  )
}

/** One "throttled" row per (email, IP) and window, so a flood of blocked requests cannot fill the table. */
export function recordThrottled(email: string, headers: Headers | null | undefined): void {
  const since = windowStart(env.loginWindowMinutes)
  const last = db
    .select({ reason: loginAttempts.reason })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, storedEmail(email, userIdByEmail(email))),
        eq(loginAttempts.ip, clientIp(headers)),
        gte(loginAttempts.at, since),
      ),
    )
    .orderBy(desc(loginAttempts.at), desc(loginAttempts.id))
    .limit(1)
    .get()
  if (last?.reason !== "throttled") recordLoginAttempt({ email, success: false, reason: "throttled", headers })
}

/** Password-reset mails: at most 3 per address and 20 per IP within an hour. */
export function resetThrottled(email: string, headers: Headers | null | undefined): boolean {
  const since = windowStart(60)
  const n = (where: SQL | undefined) =>
    db
      .select({ n: count() })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.reason, "reset_requested"), gte(loginAttempts.at, since), where))
      .get()?.n ?? 0
  const ip = clientIp(headers)
  return n(eq(loginAttempts.email, email)) >= 3 || (ip !== "" && n(eq(loginAttempts.ip, ip)) >= 20)
}

/** A person's own recent sign-in attempts (successful and failed), newest first. */
export function ownLoginHistory(userId: number, limit = 50): LoginAttempt[] {
  return db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.userId, userId), ne(loginAttempts.reason, "reset_requested")))
    .orderBy(desc(loginAttempts.at), desc(loginAttempts.id))
    .limit(limit)
    .all()
}

/** "Chrome on macOS" from a user agent (no parsing library; good enough for a device list). */
export function describeAgent(ua: string | null | undefined): string {
  const s = (ua ?? "").toLowerCase()
  const browser =
    [
      ["edg/", "Edge"],
      ["firefox", "Firefox"],
      ["chrome", "Chrome"],
      ["safari", "Safari"],
      ["curl", "curl"],
      ["node", "Node"],
    ].find(([k]) => s.includes(k))?.[1] ?? "Browser"
  const os = [
    ["iphone", "iOS"],
    ["ipad", "iPadOS"],
    ["android", "Android"],
    ["windows", "Windows"],
    ["mac os", "macOS"],
    ["linux", "Linux"],
  ].find(([k]) => s.includes(k))?.[1]
  return os ? `${browser} · ${os}` : browser
}
