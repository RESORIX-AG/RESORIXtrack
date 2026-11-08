/**
 * The signed-in person's own settings and security: profile fields, signed-in devices, API keys,
 * two-factor status and sign-in history. Everything here acts on the actor only.
 */
import { and, desc, eq, gt, ne } from "drizzle-orm"
import type { Locale } from "@/lib/locales"
import { db } from "../db"
import { apikey, passkey, session, twoFactor, type User, users } from "../db/schema"
import { NotFound, Validation } from "../errors"
import { iso, utcnow } from "../time"
import { apiKeyScopes } from "./api-keys"
import { invalidateInvites } from "./invites"
import { describeAgent, ownLoginHistory } from "./login-log"
import { hasPasskey, mfaEnrolmentDue, mfaPolicyApplies, mfaRequiredFor } from "./mfa-policy"
import { hasOidcLink, linkedProviders } from "./oidc"
import type { Actor } from "./permissions"
import { record, snapshot } from "./revisions"
import { hasPassword } from "./user-auth"

export interface ProfileInput {
  name: string
  locale: Locale
  timeFormat: "24h" | "12h"
  notifyEmailOnCorrection: boolean
}

export function serializeProfile(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    locale: u.locale,
    timezone: u.timezone,
    timeFormat: u.timeFormat,
    notifyEmailOnCorrection: u.notifyEmailOnCorrection,
  }
}

export function updateProfile(actor: Actor, input: ProfileInput): User {
  const name = input.name.trim()
  if (!name) throw new Validation("Enter your name", { fields: { name: "required" } })
  const u = actor.user
  const before = snapshot("user", u)
  const updated = db
    .update(users)
    .set({
      name,
      locale: input.locale,
      timeFormat: input.timeFormat,
      notifyEmailOnCorrection: input.notifyEmailOnCorrection,
    })
    .where(eq(users.id, actor.id))
    .returning()
    .get()
  if (JSON.stringify(snapshot("user", updated)) !== JSON.stringify(before))
    record({ entity: "user", row: updated, action: "update", actor, subjectUserId: u.id, before })
  return updated
}

export function listSessions(actor: Actor, currentSessionId: number | null) {
  return db
    .select()
    .from(session)
    .where(and(eq(session.userId, actor.id), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.updatedAt))
    .all()
    .map((s) => ({
      id: s.id,
      device: describeAgent(s.userAgent),
      ip: s.ipAddress ?? "",
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.updatedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    }))
}

export function revokeSession(actor: Actor, sessionId: number): void {
  const n = db
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, actor.id)))
    .run().changes
  if (!n) throw new NotFound("Session not found")
}

export function revokeOtherSessions(actor: Actor, currentSessionId: number | null): number {
  const where =
    currentSessionId == null
      ? eq(session.userId, actor.id)
      : and(eq(session.userId, actor.id), ne(session.id, currentSessionId))
  return db.delete(session).where(where).run().changes
}

/** API keys of the actor (never the key itself; only its first characters). */
export function listApiKeys(actor: Actor) {
  return db
    .select()
    .from(apikey)
    .where(eq(apikey.referenceId, String(actor.id)))
    .orderBy(desc(apikey.createdAt))
    .all()
    .map((k) => ({
      id: k.id,
      name: k.name ?? "",
      start: k.start ?? k.prefix ?? "",
      scopes: apiKeyScopes(k.permissions),
      createdAt: k.createdAt.toISOString(),
      expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      lastUsedAt: k.lastRequest ? k.lastRequest.toISOString() : null,
      uses: k.requestCount ?? 0,
      expired: Boolean(k.expiresAt && k.expiresAt <= new Date()),
    }))
}

export function revokeApiKey(actor: Actor, keyId: number): void {
  const n = db
    .delete(apikey)
    .where(and(eq(apikey.id, keyId), eq(apikey.referenceId, String(actor.id))))
    .run().changes
  if (!n) throw new NotFound("Key not found")
}

export function revokeAllApiKeys(userId: number): number {
  return db
    .delete(apikey)
    .where(eq(apikey.referenceId, String(userId)))
    .run().changes
}

/** After a password change (v1 rules): stamp it, kill pending invitation links and every API key. */
export function afterPasswordChanged(userId: number): void {
  db.update(users).set({ passwordChangedAt: utcnow() }).where(eq(users.id, userId)).run()
  invalidateInvites(userId)
  revokeAllApiKeys(userId)
}

/** Two-factor and sign-in methods. `backupCodesLeft` is filled by the caller (needs Better Auth to decrypt). */
export function securityState(actor: Actor) {
  const u = db.select().from(users).where(eq(users.id, actor.id)).get()
  if (!u) throw new NotFound("User not found")
  const tf = db.select().from(twoFactor).where(eq(twoFactor.userId, actor.id)).get()
  return {
    twoFactorEnabled: Boolean(u.twoFactorEnabled) && tf?.verified !== false,
    mfaPolicy: mfaPolicyApplies(u),
    mfaLocked: mfaRequiredFor(u),
    mfaDue: mfaEnrolmentDue(u),
    oidcLinked: hasOidcLink(u.id),
    hasPasskey: hasPasskey(u.id),
    hasPassword: hasPassword(u.id),
    providers: linkedProviders(u.id),
    passwordChangedAt: iso(u.passwordChangedAt),
  }
}

export function loginHistory(actor: Actor) {
  return ownLoginHistory(actor.id).map((a) => ({
    id: a.id,
    at: iso(a.at),
    success: a.success,
    reason: a.reason,
    ip: a.ip,
    device: describeAgent(a.userAgent),
  }))
}

// Well-known authenticator AAGUIDs (FIDO metadata / passkey-authenticator-aaguids list); unknown ones show no label.
const AAGUID_LABELS: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "b5397666-4885-aa6b-cebf-e52262a439a2": "Chromium Browser",
  "771b48fd-d3d4-4f74-9232-fc157ab0507a": "Edge on Mac",
  "cb69481e-8ff7-4039-93ec-0a2729a154a8": "YubiKey 5",
  "ee882879-721c-4913-9775-3dfcce97072a": "YubiKey 5",
  "fa2b99dc-9e39-4257-8f92-4a30d23c4118": "YubiKey 5 NFC",
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": "YubiKey 5 NFC",
  "a4e9fc6d-4cbe-4758-b8ba-37598bb5bbaa": "Security Key NFC",
}

export function listPasskeys(actor: Actor) {
  return db
    .select()
    .from(passkey)
    .where(eq(passkey.userId, actor.id))
    .orderBy(desc(passkey.id))
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name ?? "",
      provider: (p.aaguid && AAGUID_LABELS[p.aaguid.toLowerCase()]) || null,
      createdAt: p.createdAt ? p.createdAt.toISOString() : null,
      synced: p.backedUp,
    }))
}

function ownPasskey(actor: Actor, id: number) {
  const row = db
    .select()
    .from(passkey)
    .where(and(eq(passkey.id, id), eq(passkey.userId, actor.id)))
    .get()
  if (!row) throw new NotFound("Passkey not found")
  return row
}

export function renamePasskey(actor: Actor, id: number, name: string): void {
  ownPasskey(actor, id)
  db.update(passkey)
    .set({ name: name.trim().slice(0, 60) })
    .where(eq(passkey.id, id))
    .run()
}

export function deletePasskey(actor: Actor, id: number): void {
  ownPasskey(actor, id)
  db.delete(passkey).where(eq(passkey.id, id)).run()
}
