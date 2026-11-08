/**
 * Adding a passkey needs the password first (people without one, e.g. single sign-on only, confirm nothing):
 * a passkey replaces password and second factor, so a stolen session must not be able to plant one. The
 * confirmation is kept for a few minutes in app_state and used up by a successful registration.
 */
import { grant, granted, revoke } from "./expiring-grants"

const MINUTES = 5
const key = (userId: number) => `passkey_step_up:${userId}`

export function grantPasskeyRegistration(userId: number): void {
  grant(key(userId), MINUTES)
}

export function passkeyRegistrationAllowed(userId: number): boolean {
  return granted(key(userId))
}

export function consumePasskeyRegistration(userId: number): void {
  revoke(key(userId))
}
