/** App sign-in: `POST /auth/token` hands a desktop or mobile app an API key for email, password and second factor. */
import { z } from "zod"
import { clientIp } from "../client-ip"
import { env } from "../env"
import { TooManyRequests } from "../errors"
import { API_SCOPE_LIST, APP_KEY_DEFAULT_DAYS, APP_KEY_MAX_DAYS, appSignIn } from "../services/app-sign-in"
import { RateLimited } from "./auth"
import { publicEndpoint } from "./endpoint"
import { TokenBuckets } from "./rate-limit"
import { instant } from "./schemas"

/** Per client address, on top of the failure throttle: a burst of 20 sign-ins, then one every 5 seconds. */
export const signInBuckets = new TokenBuckets(20, 0.2)

const AppToken = z
  .object({
    token: z.string().meta({ description: "The API key (`rt_…`); shown once." }),
    id: z.number().int(),
    name: z.string(),
    scopes: z.array(z.string()),
    expiresAt: instant.nullable(),
  })
  .meta({ id: "AppToken" })

export const appToken = publicEndpoint({
  method: "POST",
  path: "/auth/token",
  tag: "Auth",
  summary: "Sign in from an app and receive an API key",
  description:
    "Email and password, plus `code` (authenticator or backup code) when two-factor authentication is enabled: without it the answer is `401 mfa_required`. The key is shown once; it acts as its owner within the requested scopes and expires after `expiresInDays` (default 90, at most 365). Same throttle and sign-in log as the web sign-in. `403 mfa_required` when the company requires two-factor authentication that is not set up yet (enrol in the web app), `403 oidc_only` when passwords are switched off in favour of single sign-on.",
  body: z.object({
    email: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
    code: z.string().trim().max(20).optional().meta({
      description: "Authenticator code (6 digits) or a backup code; required with two-factor authentication.",
    }),
    name: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .meta({ description: "Shown under Profile → API keys, e.g. the device name.", examples: ["Laptop at home"] }),
    scopes: z
      .array(z.string().max(32))
      .min(1)
      .max(10)
      .default([...API_SCOPE_LIST])
      .meta({ description: `Default: all scopes (${API_SCOPE_LIST.join(", ")}).` }),
    expiresInDays: z.number().int().min(1).max(APP_KEY_MAX_DAYS).default(APP_KEY_DEFAULT_DAYS),
  }),
  response: AppToken,
  status: 201,
  errors: {
    "401":
      "Wrong email or password (`invalid_credentials`); second factor missing (`mfa_required`) or wrong (`invalid_mfa`)",
    "403":
      "API keys switched off (`api_keys_disabled`); password sign-in switched off (`oidc_only`); two-factor authentication required but not set up (`mfa_required`)",
    "422": "Validation failed; `fields` names the problems (unknown scope: `scopes`)",
    "429": "Too many failed sign-ins, or too many requests from this address; see Retry-After",
  },
  handler: async ({ request, body }) => {
    // an unknown address shares one bucket rather than going unlimited
    const wait = signInBuckets.take(clientIp(request.headers) || "unknown")
    if (wait) throw new RateLimited(wait)
    try {
      return await appSignIn({ ...body, headers: request.headers })
    } catch (err) {
      // the failure throttle (and the two-factor lockout) block for a window: tell the app how long to wait
      if (err instanceof TooManyRequests && !(err instanceof RateLimited))
        throw new RateLimited(env.loginWindowMinutes * 60, err.message)
      throw err
    }
  },
})
