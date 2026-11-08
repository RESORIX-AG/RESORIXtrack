/**
 * Session bootstrap: everything the shell needs on every page (who is signed in, what they may do,
 * locale, company branding, badge counts). Loaded by the root route on the server and cached on the client.
 */
import { createServerFn } from "@tanstack/react-start"
import { getCookie, getRequestHeader } from "@tanstack/react-start/server"
import { LOCALE_COOKIE, type Locale, pickLocale } from "@/lib/i18n-core"
import { optionalAuth } from "../middleware"
import { pendingApprovalCount } from "../services/approvals-count"
import { mfaEnrolmentDue } from "../services/mfa-policy"
import { unreadCount } from "../services/notifications"
import { isManager } from "../services/permissions"
import { getAllSettings } from "../services/settings"

/** Theme preference from the rt_theme cookie; "system" follows the device. */
export type Theme = "system" | "light" | "dark"

export interface Me {
  id: number
  name: string
  email: string
  role: "admin" | "employee"
  teamId: number | null
  timezone: string
  locale: string
  timeFormat: "24h" | "12h"
  capabilities: string[]
  isAdmin: boolean
  isHr: boolean
  isLead: boolean
  isManager: boolean
  canProjects: boolean
  twoFactorEnabled: boolean
  mfaRequired: boolean
  /** Two-factor setup is required before anything but the profile works. */
  mfaDue: boolean
}

export interface Bootstrap {
  me: Me | null
  locale: Locale
  theme: Theme
  company: {
    name: string
    brandAccent: string
    setupComplete: boolean
    defaultTimezone: string
    projectMode: "off" | "optional" | "required"
    apiTokensEnabled: boolean
  }
  counts: { unread: number; pendingApprovals: number }
}

export const getBootstrap = createServerFn({ method: "GET" })
  .middleware([optionalAuth])
  .handler(({ context: { actor } }): Bootstrap => {
    const s = getAllSettings()
    const cookie = getCookie("rt_theme")
    const theme: Theme = cookie === "light" || cookie === "dark" ? cookie : "system"
    const locale = pickLocale(
      actor?.user.locale,
      getCookie(LOCALE_COOKIE),
      getRequestHeader("accept-language"),
      s.default_locale,
    )
    let me: Me | null = null
    if (actor) {
      const u = actor.user
      const isLead = actor.ledTeamIds.size > 0
      me = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        teamId: u.teamId,
        timezone: u.timezone,
        locale: u.locale,
        timeFormat: u.timeFormat,
        capabilities: [...actor.caps],
        isAdmin: actor.isAdmin,
        isHr: actor.isHr,
        isLead,
        isManager: isManager(actor),
        canProjects: isManager(actor) || actor.caps.has("projects"),
        twoFactorEnabled: Boolean(u.twoFactorEnabled),
        mfaRequired: s.mfa_required_for_all || (actor.isAdmin && s.mfa_required_for_admins),
        mfaDue: mfaEnrolmentDue(u),
      }
    }
    return {
      me,
      locale,
      theme,
      company: {
        name: s.company_name,
        brandAccent: s.brand_accent,
        setupComplete: s.setup_complete,
        defaultTimezone: s.default_timezone,
        projectMode: s.project_mode,
        apiTokensEnabled: s.api_tokens_enabled,
      },
      counts: actor
        ? { unread: unreadCount(actor.id), pendingApprovals: pendingApprovalCount(actor) }
        : { unread: 0, pendingApprovals: 0 },
    }
  })
