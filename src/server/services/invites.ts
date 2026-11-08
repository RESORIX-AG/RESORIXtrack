/**
 * Invitations (auth_tokens, purpose "invite"): a random token, stored as SHA-256 hash, valid 7 days,
 * single use. The link carries it in the URL fragment so it never reaches server logs. Accepting sets the
 * password (policy + breach check) and the caller signs the person in.
 * Interface used by admin (create user, resend invite) and Better Auth (reset request without password).
 */
import { createHash, randomBytes } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { isSupportedLocale } from "@/lib/locales"
import { db, rawSqlite } from "../db"
import { authTokens, type User, users } from "../db/schema"
import { env } from "../env"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import { hashPassword } from "../password"
import { fmtInstant, iso, isValidTz, nowInstant, utcnow } from "../time"
import { queueMail } from "./mail"
import { oidcEnabled } from "./oidc"
import type { Actor } from "./permissions"
import { checkNewPassword, setPasswordHash } from "./user-auth"

export const INVITE_DAYS = 7

export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex")

/** Mark every open invitation of the person as used (new link, password set elsewhere, reset). */
export function invalidateInvites(userId: number): void {
  db.update(authTokens)
    .set({ usedAt: utcnow() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, "invite"), isNull(authTokens.usedAt)))
    .run()
}

/** New token (older links stop working) and the invitation mail, sent only if the token was committed. */
export function issueInviteToken(user: User, actorName: string | null): { url: string; expiresAt: string } {
  invalidateInvites(user.id)
  const raw = randomBytes(32).toString("base64url")
  const tokenHash = hashToken(raw)
  const expiresAt = fmtInstant(nowInstant().add({ hours: INVITE_DAYS * 24 }))
  db.insert(authTokens).values({ userId: user.id, purpose: "invite", tokenHash, expiresAt }).run()
  const url = `${env.baseUrl}/invite#token=${raw}`
  queueMail(
    { email: user.email, name: user.name, locale: user.locale },
    "invite",
    { url, days: INVITE_DAYS, email: user.email, ...(actorName ? { actorName } : {}) },
    {
      when: () =>
        Boolean(
          db
            .select({ id: authTokens.id })
            .from(authTokens)
            .where(and(eq(authTokens.tokenHash, tokenHash), isNull(authTokens.usedAt)))
            .get(),
        ),
    },
  )
  return { url, expiresAt: iso(expiresAt) }
}

/** Create a fresh invite token for the person and email it (after commit). Returns the accept URL (dev display). */
export function sendInvite(actor: Actor, userId: number): { url: string; expiresAt: string } {
  if (!actor.isAdmin) throw new Forbidden("Only administrators can invite people")
  const target = db.select().from(users).where(eq(users.id, userId)).get()
  if (!target) throw new NotFound("User not found")
  if (!target.isActive) throw new Conflict("The account is deactivated", { code: "user_inactive" })
  return issueInviteToken(target, actor.user.name)
}

function openToken(raw: string) {
  const tok = raw
    ? db
        .select()
        .from(authTokens)
        .where(eq(authTokens.tokenHash, hashToken(raw)))
        .get()
    : undefined
  const user = tok ? db.select().from(users).where(eq(users.id, tok.userId)).get() : undefined
  if (!tok || !user || tok.purpose !== "invite" || tok.usedAt != null || tok.expiresAt <= utcnow() || !user.isActive)
    throw new Validation("This link is invalid or has expired", { code: "invalid_token", fields: { token: "invalid" } })
  return { tok, user }
}

/** What the invitation page shows before the password is chosen. */
export function inviteInfo(raw: string): { name: string; email: string; locale: string; expiresAt: string } {
  const { tok, user } = openToken(raw)
  return { name: user.name, email: user.email, locale: user.locale, expiresAt: iso(tok.expiresAt) }
}

/** Accept: check the password policy, set it, use up the token. Returns the person (the caller signs in). */
export async function acceptInvite(
  raw: string,
  input: { password: string; locale?: string; timezone?: string },
): Promise<User> {
  const { user } = openToken(raw)
  // single sign-on only: a password would be a way around the identity provider
  if (env.oidc.only && oidcEnabled()) throw new Forbidden("Sign in with single sign-on", { code: "oidc_only" })
  if (input.timezone && !isValidTz(input.timezone))
    throw new Validation("Unknown timezone", { fields: { timezone: "invalid" } })
  await checkNewPassword(input.password, user.email)
  const hash = await hashPassword(input.password)
  return rawSqlite().transaction(() => {
    const { tok } = openToken(raw) // again: the token may have been used while hashing
    db.update(authTokens).set({ usedAt: utcnow() }).where(eq(authTokens.id, tok.id)).run()
    invalidateInvites(user.id)
    setPasswordHash(user.id, hash)
    return db
      .update(users)
      .set({
        emailVerified: true,
        ...(isSupportedLocale(input.locale) ? { locale: input.locale } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      })
      .where(eq(users.id, user.id))
      .returning()
      .get()
  })()
}
