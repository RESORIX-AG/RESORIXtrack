/**
 * App sign-in: a desktop or mobile app obtains an API key with email and password – plus the authenticator or
 * a backup code when two-factor authentication is on – without a browser session (`POST /api/v1/auth/token`).
 *
 * Same rules as the web sign-in: Argon2id verification, OIDC-only mode with its break-glass window, the failure
 * throttle and the sign-in log (`token_issued` on success). The second factor is checked by Better Auth's own
 * two-factor endpoints against a challenge like the web's, so secret decryption, the time window, the attempt
 * budget and the account lockout are the plugin's; the session a correct code creates is dropped at once. The
 * key itself is created exactly like one from the profile page.
 */
import { APIError } from "better-auth/api"
import { and, eq } from "drizzle-orm"
import { isRecord } from "@/lib/guards"
import { API_SCOPES, auth, withSignInReason } from "../auth"
import { PEER_HEADER } from "../client-ip"
import { db } from "../db"
import { account, session, type User, users } from "../db/schema"
import { env } from "../env"
import { Forbidden, TooManyRequests, Unauthorized, Validation } from "../errors"
import { hashPassword, verifyPassword } from "../password"
import { utcnow } from "../time"
import { breakGlassAllowed, consumeBreakGlass } from "./break-glass"
import { loginThrottled, recordLoginAttempt, recordThrottled } from "./login-log"
import { passwordAloneRefused } from "./mfa-policy"
import { oidcEnabled } from "./oidc"
import { getSetting } from "./settings"

export const APP_KEY_DEFAULT_DAYS = 90
export const APP_KEY_MAX_DAYS = 365

/** Every `resource:action` scope an API key can hold. */
export const API_SCOPE_LIST: readonly string[] = Object.entries(API_SCOPES).flatMap(([res, actions]) =>
  actions.map((a) => `${res}:${a}`),
)

export interface AppSignInInput {
  email: string
  password: string
  /** Authenticator (TOTP) or backup code; required when two-factor authentication is enabled. */
  code?: string | undefined
  /** Name of the key (device or app), shown under Profile → API keys. */
  name: string
  scopes: string[]
  expiresInDays: number
  /** Request headers: client address and user agent for the sign-in log and the throttle. */
  headers: Headers
}

export interface AppKey {
  /** The plaintext key, shown once. */
  token: string
  id: number
  name: string
  scopes: string[]
  expiresAt: string | null
}

/** Better Auth permissions `{ resource: [actions] }` of a scope list; unknown scopes are refused. */
export function permissionsOf(scopes: string[]): Record<string, string[]> {
  const permissions: Record<string, string[]> = {}
  for (const scope of new Set(scopes)) {
    if (!API_SCOPE_LIST.includes(scope)) throw new Validation("Unknown scope", { fields: { scopes: "invalid" } })
    const [res, action] = scope.split(":")
    permissions[res] = [...(permissions[res] ?? []), action]
  }
  return permissions
}

const invalidCredentials = () => new Unauthorized("Email or password is incorrect", { code: "invalid_credentials" })

/** Password check with the sign-in log of the web sign-in: unknown address, wrong password or inactive account. */
async function checkPassword(email: string, password: string, headers: Headers): Promise<User> {
  const user = db.select().from(users).where(eq(users.email, email)).get()
  const hash = user
    ? db
        .select({ p: account.password })
        .from(account)
        .where(and(eq(account.userId, user.id), eq(account.providerId, "credential")))
        .get()?.p
    : null
  let valid = false
  if (hash) valid = await verifyPassword({ hash, password })
  else await hashPassword(password) // same cost as a check, so unknown addresses answer no faster (as Better Auth does)
  if (!user || !valid) {
    // the log turns `invalid_password` for an unknown address into `unknown_user` (masked)
    recordLoginAttempt({ email, userId: user?.id, success: false, reason: "invalid_password", headers })
    throw invalidCredentials()
  }
  if (!user.isActive || user.anonymizedAt) {
    recordLoginAttempt({ email, userId: user.id, success: false, reason: "inactive", headers })
    throw invalidCredentials()
  }
  return user
}

/** Headers passed on to Better Auth: client address and agent for the log; never the app's other headers. */
function forwarded(headers: Headers, cookie?: string): Headers {
  const h = new Headers()
  for (const name of ["user-agent", "x-forwarded-for", PEER_HEADER]) {
    const v = headers.get(name)
    if (v) h.set(name, v)
  }
  if (cookie) h.set("cookie", cookie)
  return h
}

function dropSession(token: unknown): void {
  if (typeof token === "string" && token) db.delete(session).where(eq(session.token, token)).run()
}

function twoFactorError(err: unknown): never {
  if (!(err instanceof APIError)) throw err
  if (err.status === "TOO_MANY_REQUESTS" || err.body?.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE")
    throw new TooManyRequests(err.message)
  throw new Unauthorized("The code is not valid", { code: "invalid_mfa" })
}

/** Backup codes are printed as `xxxxx-xxxxx`; accept them typed without the dash. */
const backupCodeShape = (code: string) => (/^[a-z0-9]{10}$/i.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}` : code)

/**
 * The web's second step without a browser: Better Auth's credential sign-in answers a two-factor challenge
 * (no session yet), the code is verified against that challenge, and the session a correct code creates is
 * dropped. The auth hooks write the sign-in log (`token_issued` or `mfa_failed`).
 */
async function verifySecondFactor(user: User, password: string, code: string, headers: Headers): Promise<void> {
  await withSignInReason("token_issued", async () => {
    let challenge: string | undefined
    try {
      const signIn = await auth.api.signInEmail({
        body: { email: user.email, password },
        headers: forwarded(headers),
        returnHeaders: true,
      })
      const res: unknown = signIn.response
      if (isRecord(res)) dropSession(res.token) // only set when no second factor was asked for
      challenge = signIn.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .find((c) => /^[^=]*two_factor=.+/.test(c))
    } catch (err) {
      twoFactorError(err)
    }
    if (!challenge) throw new Error("two-factor challenge missing after the credential sign-in")
    const h = forwarded(headers, challenge)
    try {
      const r = /^\d{6}$/.test(code)
        ? await auth.api.verifyTOTP({ body: { code }, headers: h })
        : await auth.api.verifyBackupCode({ body: { code: backupCodeShape(code) }, headers: h })
      dropSession(r.token)
    } catch (err) {
      twoFactorError(err)
    }
  })
}

export async function appSignIn(input: AppSignInInput): Promise<AppKey> {
  if (!getSetting("api_tokens_enabled"))
    throw new Forbidden("API keys are disabled for this company", { code: "api_keys_disabled" })
  const scopes = [...new Set(input.scopes)].sort()
  const permissions = permissionsOf(scopes)
  const days = Math.min(Math.max(1, Math.floor(input.expiresInDays)), APP_KEY_MAX_DAYS)
  const email = input.email.trim().toLowerCase().slice(0, 254)
  const { headers } = input

  if (env.oidc.only && oidcEnabled() && !breakGlassAllowed(email))
    throw new Forbidden("Sign in with single sign-on", { code: "oidc_only" })
  if (loginThrottled(email, headers)) {
    recordThrottled(email, headers)
    throw new TooManyRequests("Too many failed attempts. Wait a few minutes.")
  }

  const user = await checkPassword(email, input.password, headers)
  let logged = false
  if (user.twoFactorEnabled) {
    const code = (input.code ?? "").replace(/\s+/g, "")
    if (!code)
      throw new Unauthorized("Two-factor authentication is enabled: send the authenticator or backup code as `code`", {
        code: "mfa_required",
      })
    await verifySecondFactor(user, input.password, code, headers)
    logged = true
  } else if (passwordAloneRefused(user)) {
    throw new Forbidden("Two-factor authentication is required for your account: set it up in the web app first", {
      code: "mfa_required",
    })
  }

  const name = input.name.trim()
  const created = await auth.api.createApiKey({
    body: { userId: String(user.id), name, expiresIn: days * 86400, permissions },
  })
  consumeBreakGlass(email)
  db.update(users).set({ lastLoginAt: utcnow() }).where(eq(users.id, user.id)).run()
  if (!logged) recordLoginAttempt({ email, userId: user.id, success: true, reason: "token_issued", headers })
  return {
    token: created.key,
    id: Number(created.id),
    name,
    scopes,
    expiresAt: created.expiresAt ? new Date(created.expiresAt).toISOString() : null,
  }
}
