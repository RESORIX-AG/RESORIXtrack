/**
 * Credentials for people (Better Auth `account` rows with providerId "credential"). Used by the setup
 * wizard, invitations, administrators setting a password and the CLI.
 */
import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "../db"
import { account, type User, users } from "../db/schema"
import { env } from "../env"
import { Conflict, Validation } from "../errors"
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../password"
import { utcnow } from "../time"

// Frequently used passwords of 10+ characters (shorter ones fail the length rule); the Have I Been Pwned
// check catches the long tail.
// biome-ignore format: list
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd123", "1234567890", "12345678910",
  "123456789a", "1234567890a", "qwertyuiop", "qwertyuiop1", "qwertzuiop", "qwertz1234", "1q2w3e4r5t", "1q2w3e4r5t6y",
  "letmein123", "welcome123", "welcome2024", "welcome2025", "welcome2026", "iloveyou12", "iloveyou123", "passwort123",
  "0123456789", "9876543210", "resorixtrack1", "resorix123", "changeme12", "changeme123", "administrator", "admin123456",
  "sunshine123", "princess123", "football123", "baseball123", "superman123", "trustno1234", "monkey12345",
  "dragon12345", "master12345", "summer2024", "summer2025", "summer2026", "winter2025", "winter2026",
  "january2026", "abcdefghij", "abcd1234567", "asdfghjkl1", "zxcvbnm123", "qazwsxedc1", "computer123", "internet123",
  "michael123", "jennifer123", "liverpool1", "chocolate1", "whatever12", "starwars123", "pokemon123", "samsung123",
])

export type PasswordProblem = "too_short" | "too_long" | "too_common" | "contains_email" | "breached"

/** Offline password rules (v1): length, common passwords, too few distinct characters, the email's local part. */
export function passwordProblem(password: string, email = ""): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short"
  if (password.length > MAX_PASSWORD_LENGTH) return "too_long"
  const lowered = password.toLowerCase()
  if (COMMON.has(lowered) || new Set(password).size < 4) return "too_common"
  const local = email.split("@")[0]?.toLowerCase() ?? ""
  if (local.length >= 4 && lowered.includes(local)) return "contains_email"
  return null
}

const PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
  too_long: `Use at most ${MAX_PASSWORD_LENGTH} characters`,
  too_common: "This password is too easy to guess",
  contains_email: "The password must not contain your email name",
  breached: "This password appears in known data breaches",
}

export function passwordError(problem: PasswordProblem, field = "password"): InstanceType<typeof Validation> {
  return new Validation(PROBLEM_MESSAGES[problem], { code: `password_${problem}`, fields: { [field]: problem } })
}

export function validatePasswordShape(password: string, email = ""): void {
  const problem = passwordProblem(password, email)
  if (problem) throw passwordError(problem)
}

/**
 * Have I Been Pwned range query (k-anonymity: only 5 hex chars of the SHA-1 leave the server). Fails open
 * (null) when the service is unreachable, so signing in never depends on a third party.
 */
export async function isPwnedPassword(password: string, timeoutMs = 3000): Promise<boolean | null> {
  // the HIBP range API is keyed by SHA-1 by design; the digest protects nothing, only its first 5 chars are sent
  // react-doctor-disable-next-line react-doctor/insecure-crypto-risk
  const digest = createHash("sha1").update(password).digest("hex").toUpperCase()
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, {
      headers: { "Add-Padding": "true", "User-Agent": "RESORIXtrack" },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const suffix = digest.slice(5)
    return (await res.text()).split(/\r?\n/).some((line) => {
      const [h, count] = line.split(":")
      return h === suffix && Number(count) > 0
    })
  } catch {
    return null
  }
}

/** Full policy for passwords set outside Better Auth (setup, invitations, administrators). */
export async function checkNewPassword(password: string, email = "", field = "password"): Promise<void> {
  const problem = passwordProblem(password, email)
  if (problem) throw passwordError(problem, field)
  if (env.pwnedCheck && (await isPwnedPassword(password))) throw passwordError("breached", field)
}

/** Set (or replace) a person's password hash. Does not revoke sessions – callers decide. */
export function setPasswordHash(userId: number, hash: string): void {
  const existing = db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .get()
  const now = new Date()
  if (existing) db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, existing.id)).run()
  else
    db.insert(account)
      .values({
        userId,
        accountId: String(userId),
        providerId: "credential",
        password: hash,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  db.update(users).set({ passwordChangedAt: utcnow() }).where(eq(users.id, userId)).run()
}

export async function setPassword(userId: number, password: string): Promise<void> {
  const email = db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get()?.email ?? ""
  await checkNewPassword(password, email)
  setPasswordHash(userId, await hashPassword(password))
}

export function hasPassword(userId: number): boolean {
  const row = db
    .select({ p: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .get()
  return Boolean(row?.p)
}

export async function createUserWithPassword(input: {
  email: string
  name: string
  password: string
  role?: "admin" | "employee"
  locale?: string
  timezone?: string
}): Promise<User> {
  const email = input.email.trim().toLowerCase()
  validatePasswordShape(input.password, email)
  if (db.select().from(users).where(eq(users.email, email)).get())
    throw new Conflict("Email already in use", { code: "email_taken" })
  const hash = await hashPassword(input.password)
  const user = db
    .insert(users)
    .values({
      email,
      name: input.name.trim(),
      role: input.role ?? "employee",
      locale: input.locale ?? "en",
      timezone: input.timezone ?? "Europe/Zurich",
      emailVerified: true,
    })
    .returning()
    .get()
  setPasswordHash(user.id, hash)
  return user
}
