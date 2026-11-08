/**
 * Break-glass password sign-in while OIDC_ONLY is on: `rt reset-password` allows one password sign-in for
 * that person within an hour (stored in app_state, consumed on success).
 */
import { grant, granted, revoke } from "./expiring-grants"

const key = (email: string) => `break_glass:${email.trim().toLowerCase()}`

export function grantBreakGlass(email: string, minutes = 60): string {
  return grant(key(email), minutes)
}

export function breakGlassAllowed(email: string): boolean {
  return granted(key(email))
}

export function consumeBreakGlass(email: string): void {
  revoke(key(email))
}
