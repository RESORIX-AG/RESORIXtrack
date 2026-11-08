/**
 * API key authentication for the REST API: `Authorization: Bearer rt_...` only (never cookies). Better Auth
 * verifies the key (hash, expiry, enabled) and records its last use; we add the use counter, the company-wide
 * switch, the owner's account state and a per-key rate limit. The caller acts as the key's owner, narrowed
 * to the key's scopes.
 */
import { eq, sql } from "drizzle-orm"
import { auth } from "../auth"
import { db } from "../db"
import { apikey } from "../db/schema"
import { Forbidden, TooManyRequests, Unauthorized } from "../errors"
import { mfaEnrolmentDue } from "../services/mfa-policy"
import { loadActor } from "../services/permissions"
import { getSetting } from "../services/settings"
import type { Caller, Scope } from "./endpoint"
import { TokenBuckets } from "./rate-limit"

export const keyBuckets = new TokenBuckets()

/** Thrown with the seconds a client should wait (Retry-After). */
export class RateLimited extends TooManyRequests {
  constructor(
    readonly retryAfter: number,
    message = "Too many requests. Slow down.",
  ) {
    super(message)
  }
}

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m ? m[1] : null
}

export function scopesOf(permissions: Record<string, string[]> | null | undefined): Set<string> {
  return new Set(Object.entries(permissions ?? {}).flatMap(([res, actions]) => actions.map((a) => `${res}:${a}`)))
}

export async function authenticate(request: Request): Promise<Caller> {
  const token = bearer(request)
  if (!token) throw new Unauthorized("Send an API key: Authorization: Bearer rt_...")
  if (!getSetting("api_tokens_enabled"))
    throw new Forbidden("API keys are disabled for this company", { code: "api_keys_disabled" })
  const res = await auth.api.verifyApiKey({ body: { key: token } })
  // every key the app issues expires; one without an expiry did not come through the app
  if (!res.valid || !res.key || res.key.expiresAt == null) throw new Unauthorized("Invalid or expired API key")
  const keyId = Number(res.key.id)
  const wait = keyBuckets.take(String(keyId))
  if (wait) throw new RateLimited(wait)
  const actor = loadActor(Number(res.key.referenceId))
  if (!actor.user.isActive || actor.user.anonymizedAt) throw new Unauthorized("Invalid or expired API key")
  if (mfaEnrolmentDue(actor.user))
    throw new Forbidden("Two-factor authentication is required: set it up in the web app first", {
      code: "mfa_required",
    })
  db.update(apikey)
    .set({ requestCount: sql`coalesce(${apikey.requestCount}, 0) + 1` })
    .where(eq(apikey.id, keyId))
    .run()
  const client = request.headers.get("x-client") ?? ""
  return {
    actor,
    keyId,
    scopes: scopesOf(res.key.permissions),
    source: /^desktop\b/i.test(client) ? "desktop" : "api",
  }
}

export function requireScope(caller: Caller, scope: Scope): void {
  if (!caller.scopes.has(scope))
    throw new Forbidden(`This API key lacks the scope ${scope}`, { code: "insufficient_scope", fields: { scope } })
}
