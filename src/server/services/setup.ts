/**
 * First-run setup: company settings, working time, public holidays and the first administrator.
 *
 * The one-time setup code proves that whoever runs the wizard also controls the server. It is stored as
 * SHA-256 hash in app_state, printed to the server log when the wizard is first opened, and by
 * `rt setup-code`. Required when SETUP_CODE_REQUIRED (default in production).
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto"
import { and, count, eq, gte } from "drizzle-orm"
import { describeError } from "@/lib/guards"
import { clientIp } from "../client-ip"
import { db, rawSqlite } from "../db"
import { appState, loginAttempts, type User, users } from "../db/schema"
import { env } from "../env"
import { Conflict, Forbidden, TooManyRequests, Validation } from "../errors"
import { hashPassword } from "../password"
import { fmtInstant, isValidTz, localToday, nowInstant, utcnow } from "../time"
import { ensureDefaultAbsenceTypes } from "./absence-types"
import { createCalendarFromPreset } from "./holiday-calendars"
import { recordLoginAttempt } from "./login-log"
import { actorFromUser } from "./permissions"
import { createFirstSchedule, defaultScheduleMinutes } from "./schedules"
import { getSetting, updateSettings } from "./settings"
import { checkNewPassword, setPasswordHash } from "./user-auth"

const CODE_KEY = "setup_code_hash"
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const normalize = (code: string) => code.trim().toUpperCase().replace(/[\s-]/g, "")

function userCount(): number {
  return db.select({ n: count() }).from(users).get()?.n ?? 0
}

/** The wizard is open while no account exists and setup is not marked complete. */
export function setupNeeded(): boolean {
  return !getSetting("setup_complete") && userCount() === 0
}

export function generateSetupCode(): string {
  const code = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  ).join("-")
  const hash = sha(normalize(code))
  db.insert(appState)
    .values({ key: CODE_KEY, value: hash })
    .onConflictDoUpdate({ target: appState.key, set: { value: hash, updatedAt: utcnow() } })
    .run()
  return code
}

/** Create a code if none exists yet; returns the plain code only when newly generated. */
export function ensureSetupCode(): string | null {
  if (!setupNeeded()) return null
  if (db.select().from(appState).where(eq(appState.key, CODE_KEY)).get()?.value) return null
  return generateSetupCode()
}

export function verifySetupCode(code: string): boolean {
  const stored = db.select().from(appState).where(eq(appState.key, CODE_KEY)).get()?.value
  if (!stored || !code) return false
  const given = Buffer.from(sha(normalize(code)))
  return given.length === stored.length && timingSafeEqual(given, Buffer.from(stored))
}

export function clearSetupCode(): void {
  db.delete(appState).where(eq(appState.key, CODE_KEY)).run()
}

export function setupCodeBanner(code: string): string {
  const line = "=".repeat(72)
  return `\n${line}\n  RESORIXtrack first-run setup\n  Open the web app and enter this one-time setup code:\n\n      ${code}\n\n  (new code: rt setup-code)\n${line}`
}

export interface SetupInput {
  setupCode?: string
  companyName: string
  locale: string
  timezone: string
  fulltimeWeeklyMinutes: number
  defaultVacationDays: number
  holidayPreset?: string | null
  holidayPresetDays?: string[]
  adminName: string
  adminEmail: string
  adminPassword: string
  employmentStart?: string | null
}

function codeThrottled(headers: Headers | null | undefined): boolean {
  const since = fmtInstant(nowInstant().subtract({ minutes: 15 }))
  const n =
    db
      .select({ n: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.reason, "setup_code"),
          eq(loginAttempts.ip, clientIp(headers)),
          gte(loginAttempts.at, since),
        ),
      )
      .get()?.n ?? 0
  return n >= 10
}

/**
 * Complete the wizard. Returns the administrator (the caller signs them in) and whether the holiday preset
 * could be installed (it is optional; a failure does not block the setup).
 */
export async function completeSetup(
  input: SetupInput,
  headers?: Headers | null,
): Promise<{ admin: User; holidaysInstalled: boolean }> {
  if (!setupNeeded()) throw new Conflict("Setup has already been completed", { code: "setup_done" })
  if (env.setupCodeRequired) {
    if (codeThrottled(headers)) throw new TooManyRequests("Too many attempts. Wait a few minutes.")
    if (!verifySetupCode(input.setupCode ?? "")) {
      recordLoginAttempt({ email: "setup", success: false, reason: "setup_code", headers })
      throw new Forbidden("The setup code is missing or wrong", {
        code: "setup_code_invalid",
        fields: { setupCode: "invalid" },
      })
    }
  }
  if (!isValidTz(input.timezone)) throw new Validation("Unknown timezone", { fields: { timezone: "invalid" } })
  const email = input.adminEmail.trim().toLowerCase()
  await checkNewPassword(input.adminPassword, email, "adminPassword")
  const hash = await hashPassword(input.adminPassword)

  const admin = rawSqlite().transaction(() => {
    if (!setupNeeded()) throw new Conflict("Setup has already been completed", { code: "setup_done" })
    updateSettings({
      company_name: input.companyName.trim(),
      default_locale: input.locale,
      default_timezone: input.timezone,
      fulltime_weekly_minutes: input.fulltimeWeeklyMinutes,
      default_vacation_days: input.defaultVacationDays,
    })
    ensureDefaultAbsenceTypes()
    const start = input.employmentStart || localToday(input.timezone)
    const user = db
      .insert(users)
      .values({
        email,
        name: input.adminName.trim(),
        role: "admin",
        // the founding administrator starts with every capability; hand them on later
        capabilities: ["hr", "projects"],
        locale: input.locale,
        timezone: input.timezone,
        employmentStart: start,
        vacationDaysPerYear: input.defaultVacationDays,
        emailVerified: true,
      })
      .returning()
      .get()
    setPasswordHash(user.id, hash)
    createFirstSchedule(actorFromUser(user), user, {
      validFrom: start,
      pensumPercent: 100,
      minutes: defaultScheduleMinutes(input.fulltimeWeeklyMinutes),
    })
    clearSetupCode()
    return user
  })()

  let holidaysInstalled = false
  const preset = input.holidayPreset
  if (preset) {
    try {
      rawSqlite().transaction(() =>
        createCalendarFromPreset(preset, { makeDefault: true, presetDays: input.holidayPresetDays, source: "setup" }),
      )()
      holidaysInstalled = true
    } catch (err) {
      console.warn(`[setup] holiday preset ${preset} not installed: ${describeError(err)}`)
    }
  }
  updateSettings({ setup_complete: true })
  return { admin, holidaysInstalled }
}
