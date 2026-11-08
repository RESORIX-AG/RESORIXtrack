/** Two-factor policy: who must use a second factor, and who satisfies it. */
import { eq } from "drizzle-orm"
import { db } from "../db"
import { passkey, type User } from "../db/schema"
import { hasOidcLink, oidcEnabled } from "./oidc"
import { getSetting } from "./settings"

export function mfaPolicyApplies(user: Pick<User, "role">): boolean {
  return getSetting("mfa_required_for_all") || (user.role === "admin" && getSetting("mfa_required_for_admins"))
}

export function hasPasskey(userId: number): boolean {
  return Boolean(db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, userId)).get())
}

/**
 * Strong sign-in without TOTP: a registered passkey, or a link to the single sign-on provider (it handles the
 * second factor) while single sign-on is configured.
 */
function strongAlternative(userId: number): boolean {
  return hasPasskey(userId) || (oidcEnabled() && hasOidcLink(userId))
}

export function mfaSatisfied(user: Pick<User, "id" | "twoFactorEnabled">): boolean {
  return Boolean(user.twoFactorEnabled) || strongAlternative(user.id)
}

/** Must the person keep TOTP on (it may not be disabled)? */
export function mfaRequiredFor(user: Pick<User, "id" | "role">): boolean {
  return mfaPolicyApplies(user) && !strongAlternative(user.id)
}

/**
 * A password alone is not enough: the policy applies and TOTP is off. People with a passkey or a single
 * sign-on link use those; people with nothing may only enrol (`mfaEnrolmentDue`).
 */
export function passwordAloneRefused(user: Pick<User, "id" | "role" | "twoFactorEnabled">): boolean {
  return mfaPolicyApplies(user) && !user.twoFactorEnabled
}

/** Enrolment required before anything else: the policy applies and nothing satisfies it yet. */
export function mfaEnrolmentDue(user: Pick<User, "id" | "role" | "twoFactorEnabled">): boolean {
  return mfaPolicyApplies(user) && !mfaSatisfied(user)
}
