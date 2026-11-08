/**
 * Signed-out server functions: public auth configuration, first-run setup, invitations.
 * Sign-in, second factor and password reset go straight to Better Auth (lib/auth-client).
 */
import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { headers } from "@/features/profile/server"
import { localeSchema } from "@/lib/locales"
import { auth, withSignInReason } from "@/server/auth"
import { env } from "@/server/env"
import { errors } from "@/server/middleware"
import { presetDays } from "@/server/services/holiday-calendars.schemas"
import { holidayPresets } from "@/server/services/holiday-presets"
import { acceptInvite, inviteInfo } from "@/server/services/invites"
import { mailConfigured } from "@/server/services/mail"
import { oidcConfig } from "@/server/services/oidc"
import { getSetting } from "@/server/services/settings"
import { completeSetup, ensureSetupCode, setupCodeBanner, setupNeeded } from "@/server/services/setup"
import { allTimezones } from "@/server/time"

/** What the sign-in pages need: single sign-on, whether reset mails can be sent, source code link. */
export const fetchAuthConfig = createServerFn({ method: "GET" })
  .middleware([errors])
  .handler(() => ({
    oidc: oidcConfig(),
    mailConfigured: mailConfigured(),
    sourceUrl: env.sourceUrl,
  }))

export const authConfigQuery = queryOptions({
  queryKey: ["auth-config"],
  queryFn: () => fetchAuthConfig(),
  staleTime: 5 * 60_000,
})

export const fetchPrivacyNotice = createServerFn({ method: "GET" })
  .middleware([errors])
  .handler(() => ({ notice: getSetting("privacy_notice"), company: getSetting("company_name") }))

export const privacyQuery = queryOptions({ queryKey: ["privacy-notice"], queryFn: () => fetchPrivacyNotice() })

// ------------------------------------------------------------------ setup

export const fetchSetupInfo = createServerFn({ method: "GET" })
  .middleware([errors])
  .handler(() => {
    const needed = setupNeeded()
    if (needed && env.setupCodeRequired) {
      const code = ensureSetupCode()
      if (code) console.log(setupCodeBanner(code))
    }
    return {
      needed,
      codeRequired: env.setupCodeRequired,
      mailConfigured: mailConfigured(),
      timezones: allTimezones(),
      presets: holidayPresets(getSetting("default_locale")),
    }
  })

export const setupInfoQuery = queryOptions({ queryKey: ["setup-info"], queryFn: () => fetchSetupInfo() })

export const setupSchema = z.object({
  setupCode: z.string().max(40).optional(),
  companyName: z.string().trim().min(1).max(120),
  locale: localeSchema,
  timezone: z.string().min(1).max(64),
  fulltimeWeeklyMinutes: z.number().int().min(60).max(6000),
  defaultVacationDays: z.number().min(0).max(366),
  holidayPreset: z.string().max(40).nullable().optional(),
  holidayPresetDays: presetDays.optional(),
  adminName: z.string().trim().min(1).max(120),
  adminEmail: z.email().max(254),
  adminPassword: z.string().min(1).max(256),
  employmentStart: z.iso.date().nullable().optional(),
})

export const runSetup = createServerFn({ method: "POST" })
  .middleware([errors])
  .validator(setupSchema)
  .handler(async ({ data }) => {
    const { admin, holidaysInstalled } = await completeSetup(data, headers())
    await withSignInReason("setup", () =>
      auth.api.signInEmail({
        body: { email: admin.email, password: data.adminPassword, rememberMe: true },
        headers: headers(),
      }),
    )
    return { ok: true, holidaysInstalled }
  })

// ------------------------------------------------------------------ invitations

const tokenSchema = z.object({ token: z.string().min(10).max(200) })

/** POST so the token never shows up in access logs. */
export const fetchInviteInfo = createServerFn({ method: "POST" })
  .middleware([errors])
  .validator(tokenSchema)
  .handler(({ data }) => inviteInfo(data.token))

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([errors])
  .validator(
    tokenSchema.extend({
      password: z.string().min(1).max(256),
      locale: localeSchema.optional(),
      timezone: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await acceptInvite(data.token, data)
    await withSignInReason("invite", () =>
      auth.api.signInEmail({
        body: { email: user.email, password: data.password, rememberMe: true },
        headers: headers(),
      }),
    )
    return { ok: true }
  })
