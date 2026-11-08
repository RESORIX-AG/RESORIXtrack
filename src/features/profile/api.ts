/**
 * Profile & security server functions (always the signed-in person). Two-factor enrolment itself runs
 * through the Better Auth client (lib/auth-client); these provide status, sessions, keys and history.
 */
import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { localeSchema } from "@/lib/locales"
import { auth } from "@/server/auth"
import { env } from "@/server/env"
import { Conflict, Validation } from "@/server/errors"
import { authed, authedEnrolment, tx } from "@/server/middleware"
import { queueMail } from "@/server/services/mail"
import { unlinkProvider } from "@/server/services/oidc"
import { grantPasskeyRegistration } from "@/server/services/passkey-step-up"
import {
  afterPasswordChanged,
  deletePasskey,
  listApiKeys,
  listPasskeys,
  listSessions,
  loginHistory,
  renamePasskey,
  revokeApiKey,
  revokeOtherSessions,
  revokeSession,
  securityState,
  serializeProfile,
  updateProfile,
} from "@/server/services/profile"
import { getSetting } from "@/server/services/settings"
import { hasPassword } from "@/server/services/user-auth"
import { currentSessionId, fromAuthError, headers, passwordMatches, SCOPE_LIST } from "./server"

// ------------------------------------------------------------------ profile

export const fetchProfile = createServerFn({ method: "GET" })
  .middleware([authedEnrolment])
  .handler(({ context: { actor } }) => ({
    profile: serializeProfile(actor.user),
    apiKeysEnabled: getSetting("api_tokens_enabled"),
    oidcOnly: env.oidc.only && Boolean(env.oidc.issuer && env.oidc.clientId),
  }))

export const profileQuery = queryOptions({ queryKey: ["profile"], queryFn: () => fetchProfile() })

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(
    z.object({
      name: z.string().trim().min(1).max(120),
      locale: localeSchema,
      timeFormat: z.enum(["24h", "12h"]),
      notifyEmailOnCorrection: z.boolean(),
    }),
  )
  .handler(({ data, context: { actor } }) => serializeProfile(tx(() => updateProfile(actor, data))))

// ------------------------------------------------------------------ password

export const changePassword = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) }))
  .handler(async ({ data, context: { actor } }) => {
    try {
      await auth.api.changePassword({ body: { ...data, revokeOtherSessions: true }, headers: headers() })
    } catch (err) {
      fromAuthError(err)
    }
    tx(() => afterPasswordChanged(actor.id))
    queueMail({ email: actor.user.email, name: actor.user.name, locale: actor.user.locale }, "password_changed")
    return { ok: true }
  })

// ------------------------------------------------------------------ security overview

export const fetchSecurity = createServerFn({ method: "GET" })
  .middleware([authedEnrolment])
  .handler(async ({ context: { actor } }) => {
    const state = securityState(actor)
    let backupCodesLeft: number | null = null
    if (state.twoFactorEnabled) {
      try {
        const res = await auth.api.viewBackupCodes({ body: { userId: String(actor.id) } })
        backupCodesLeft = res.backupCodes.length
      } catch {
        backupCodesLeft = null
      }
    }
    return { ...state, backupCodesLeft }
  })

export const securityQuery = queryOptions({ queryKey: ["profile", "security"], queryFn: () => fetchSecurity() })

export const unlinkSignInProvider = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(z.object({ id: z.number().int() }))
  .handler(({ data, context: { actor } }) => {
    tx(() => unlinkProvider(actor.id, data.id))
    return { ok: true }
  })

// ------------------------------------------------------------------ sessions

export const fetchSessions = createServerFn({ method: "GET" })
  .middleware([authedEnrolment])
  .handler(async ({ context: { actor } }) => listSessions(actor, await currentSessionId()))

export const sessionsQuery = queryOptions({ queryKey: ["profile", "sessions"], queryFn: () => fetchSessions() })

export const endSession = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(z.object({ id: z.number().int() }))
  .handler(({ data, context: { actor } }) => {
    tx(() => revokeSession(actor, data.id))
    return { ok: true }
  })

export const endOtherSessions = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .handler(async ({ context: { actor } }) => {
    const current = await currentSessionId()
    return { revoked: tx(() => revokeOtherSessions(actor, current)) }
  })

// ------------------------------------------------------------------ API keys

export const fetchApiKeys = createServerFn({ method: "GET" })
  .middleware([authedEnrolment])
  .handler(({ context: { actor } }) => ({ keys: listApiKeys(actor), scopes: SCOPE_LIST }))

export const apiKeysQuery = queryOptions({ queryKey: ["profile", "api-keys"], queryFn: () => fetchApiKeys() })

/** Lifetimes a personal API key can be created with. */
export const API_KEY_DAYS = [30, 90, 180, 365] as const

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      name: z.string().trim().min(1).max(60),
      scopes: z.array(z.string()).min(1).max(10),
      days: z.literal(API_KEY_DAYS),
      password: z.string().max(256),
    }),
  )
  .handler(async ({ data, context: { actor } }) => {
    if (!getSetting("api_tokens_enabled")) throw new Conflict("API keys are disabled", { code: "tokens_disabled" })
    const permissions: Record<string, string[]> = {}
    for (const scope of new Set(data.scopes)) {
      if (!SCOPE_LIST.includes(scope)) throw new Validation("Unknown scope", { fields: { scopes: "invalid" } })
      const [res, action] = scope.split(":")
      permissions[res] = [...(permissions[res] ?? []), action]
    }
    // re-authentication; people who only sign in through single sign-on have no password to confirm
    const withPassword = hasPassword(actor.id)
    if (withPassword && !(await passwordMatches(actor.id, data.password)))
      throw new Validation("Password is incorrect", { code: "invalid_password", fields: { password: "invalid" } })
    const created = await auth.api.createApiKey({
      body: { userId: String(actor.id), name: data.name, expiresIn: data.days * 86400, permissions },
    })
    return {
      id: Number(created.id),
      name: data.name,
      key: created.key,
      expiresAt: created.expiresAt ? new Date(created.expiresAt).toISOString() : null,
    }
  })

export const deleteApiKey = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(z.object({ id: z.number().int() }))
  .handler(({ data, context: { actor } }) => {
    tx(() => revokeApiKey(actor, data.id))
    return { ok: true }
  })

// ------------------------------------------------------------------ history

export const fetchLoginHistory = createServerFn({ method: "GET" })
  .middleware([authedEnrolment])
  .handler(({ context: { actor } }) => loginHistory(actor))

export const loginHistoryQuery = queryOptions({
  queryKey: ["profile", "login-history"],
  queryFn: () => fetchLoginHistory(),
})

// ------------------------------------------------------------------ passkeys (adding runs through the Better Auth client)

/** Step-up before `authClient.passkey.addPasskey`: the password, when the person has one. */
export const confirmPasskeyRegistration = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(z.object({ password: z.string().max(256) }))
  .handler(async ({ data, context: { actor } }) => {
    if (hasPassword(actor.id) && !(await passwordMatches(actor.id, data.password)))
      throw new Validation("Password is incorrect", { code: "invalid_password", fields: { password: "invalid" } })
    tx(() => grantPasskeyRegistration(actor.id))
    return { ok: true }
  })

export const fetchPasskeys = createServerFn({ method: "GET" })
  .middleware([authedEnrolment])
  .handler(({ context: { actor } }) => listPasskeys(actor))

export const passkeysQuery = queryOptions({ queryKey: ["profile", "passkeys"], queryFn: () => fetchPasskeys() })

export const renameOwnPasskey = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(z.object({ id: z.number().int(), name: z.string().trim().min(1).max(60) }))
  .handler(({ data, context: { actor } }) => {
    tx(() => renamePasskey(actor, data.id, data.name))
    return { ok: true }
  })

export const deleteOwnPasskey = createServerFn({ method: "POST" })
  .middleware([authedEnrolment])
  .validator(z.object({ id: z.number().int() }))
  .handler(({ data, context: { actor } }) => {
    tx(() => deletePasskey(actor, data.id))
    return { ok: true }
  })
