/**
 * People administration (port of v1 services/users.py + privacy.py): list, create, profile and contract
 * fields, deactivate, password and two-factor resets, vacation entitlements, history and anonymisation.
 * Administrators manage people but never see time data here (no balances).
 */
import { existsSync, unlinkSync } from "node:fs"
import path from "node:path"
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, max, or, sql } from "drizzle-orm"
import type { JsonObject } from "@/lib/json"
import { isSupportedLocale } from "@/lib/locales"
import { db } from "../db"
import {
  absences,
  account,
  apikey,
  appState,
  attachments,
  authTokens,
  CAPABILITIES,
  type Capability,
  employmentHistory,
  holidayCalendars,
  loginAttempts,
  notifications,
  passkey,
  revisions,
  session,
  teamLeads,
  teams,
  timeEntries,
  twoFactor,
  type User,
  users,
  vacationEntitlements,
  verification,
  workSchedules,
} from "../db/schema"
import { env } from "../env"
import { Conflict, NotFound, Validation } from "../errors"
import { addDays, iso, isValidTz, localDateOf, localToday, utcnow } from "../time"
import { maxDay, minDay } from "./absences.schemas"
import { accountStart } from "./accounts"
import { stopRunning } from "./clock"
import { signedMonthsOverlapping } from "./locks"
import { notify } from "./notifications"
import { deferMail } from "./outbox"
import {
  type Actor,
  activeLeadRows,
  canAdjustBalance,
  canEditSchedule,
  ensureNotJoiningOwnTeam,
  getUserOr404,
  requireAdmin,
  requireSomeoneElse,
} from "./permissions"
import { record, snapshot } from "./revisions"
import { getSetting } from "./settings"
import { archiveTerms } from "./terms"
import { currentTerms, type PersonTimeline, personTimeline } from "./timeline"
import { TERM_KEYS } from "./timeline.schemas"

const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const ANON_EMAIL = (id: number) => `anonymised-${id}@invalid.local`

export function normalizeEmail(email: string): string {
  const e = (email ?? "").trim().toLowerCase()
  if (e.length > 254 || !EMAIL_RE.test(e) || e.includes("..") || e.startsWith("."))
    throw new Validation("Invalid email address", { fields: { email: "invalid" } })
  return e
}

// ------------------------------------------------------------------ listing

export interface UserFilters {
  q?: string
  teamId?: number | "none" | null
  /** admin | hr | projects | lead | employee */
  role?: string | null
  status?: "active" | "inactive" | "all"
}

export interface UserRow {
  id: number
  name: string
  email: string
  role: "admin" | "employee"
  capabilities: Capability[]
  teamId: number | null
  teamName: string | null
  teamColor: string | null
  isLead: boolean
  /** leads only as a deputy today */
  isDeputy: boolean
  isActive: boolean
  invitePending: boolean
  mfaEnabled: boolean
  lastLoginAt: string | null
  employmentStart: string | null
  employmentEnd: string | null
  anonymized: boolean
}

function credentialUserIds(ids?: number[]): Set<number> {
  const conds = [eq(account.providerId, "credential"), isNotNull(account.password)]
  if (ids) conds.push(inArray(account.userId, ids))
  return new Set(
    db
      .select({ id: account.userId })
      .from(account)
      .where(and(...conds))
      .all()
      .map((r) => r.id),
  )
}

export function listUsers(actor: Actor, f: UserFilters = {}): UserRow[] {
  requireAdmin(actor)
  const conds = []
  const status = f.status ?? "active"
  if (status !== "all") conds.push(eq(users.isActive, status === "active"))
  if (f.teamId === "none") conds.push(isNull(users.teamId))
  else if (typeof f.teamId === "number") conds.push(eq(users.teamId, f.teamId))
  if (f.q?.trim()) {
    const q = `%${f.q.trim().toLowerCase().replace(/[%_]/g, "")}%`
    conds.push(or(like(sql`lower(${users.name})`, q), like(users.email, q)))
  }
  if (f.role === "admin" || f.role === "employee") conds.push(eq(users.role, f.role))
  const rows = db
    .select({ u: users, teamName: teams.name, teamColor: teams.color })
    .from(users)
    .leftJoin(teams, eq(teams.id, users.teamId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(users.name))
    .all()
  const leadRows = activeLeadRows()
  const leads = new Set(leadRows.map((r) => r.userId))
  const fullLeads = new Set(leadRows.filter((r) => r.role === "lead").map((r) => r.userId))
  const withPassword = credentialUserIds()
  return rows
    .map(({ u, teamName, teamColor }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      capabilities: [...(u.capabilities ?? [])].sort(),
      teamId: u.teamId,
      teamName,
      teamColor,
      isLead: leads.has(u.id),
      isDeputy: leads.has(u.id) && !fullLeads.has(u.id),
      isActive: u.isActive,
      invitePending: !withPassword.has(u.id) && u.lastLoginAt == null && u.anonymizedAt == null,
      mfaEnabled: Boolean(u.twoFactorEnabled),
      lastLoginAt: iso(u.lastLoginAt),
      employmentStart: u.employmentStart,
      employmentEnd: u.employmentEnd,
      anonymized: u.anonymizedAt != null,
    }))
    .filter((r) => {
      if (f.role === "hr" || f.role === "projects") return r.capabilities.includes(f.role)
      if (f.role === "lead") return r.isLead
      return true
    })
}

// ------------------------------------------------------------------ detail

export function getUserDetail(actor: Actor, userId: number) {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  const team = u.teamId != null ? db.select().from(teams).where(eq(teams.id, u.teamId)).get() : undefined
  const leadRows = db
    .select({ r: teamLeads, teamName: teams.name })
    .from(teamLeads)
    .innerJoin(teams, eq(teams.id, teamLeads.teamId))
    .where(eq(teamLeads.userId, u.id))
    .orderBy(asc(teams.name))
    .all()
  const activeIds = new Set(activeLeadRows({ userId: u.id }).map((r) => r.id))
  const schedules = db
    .select()
    .from(workSchedules)
    .where(eq(workSchedules.userId, u.id))
    .orderBy(desc(workSchedules.validFrom))
    .all()
  const entitlements = db
    .select()
    .from(vacationEntitlements)
    .where(eq(vacationEntitlements.userId, u.id))
    .orderBy(desc(vacationEntitlements.year))
    .all()
  const retention = retentionInfo(u)
  const timeline = personTimeline(u)
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    capabilities: [...(u.capabilities ?? [])].sort(),
    teamId: u.teamId,
    teamName: team?.name ?? null,
    holidayCalendarId: u.holidayCalendarId,
    timezone: u.timezone,
    locale: u.locale,
    employmentStart: u.employmentStart,
    employmentEnd: u.employmentEnd,
    vacationDaysPerYear: u.vacationDaysPerYear,
    legalWeeklyMaxHours: u.legalWeeklyMaxHours,
    recordingMode: u.recordingMode,
    argExempt: u.argExempt,
    regularNightWork: u.regularNightWork,
    birthDate: u.birthDate,
    isActive: u.isActive,
    isSelf: u.id === actor.id,
    invitePending: !hasCredential(u.id) && u.lastLoginAt == null && u.anonymizedAt == null,
    mfaEnabled: Boolean(u.twoFactorEnabled),
    passkeys: db.select({ n: count() }).from(passkey).where(eq(passkey.userId, u.id)).get()?.n ?? 0,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: iso(u.createdAt.toISOString()),
    anonymizedAt: iso(u.anonymizedAt),
    leadRoles: leadRows.map(({ r, teamName }) => ({
      id: r.id,
      teamId: r.teamId,
      teamName,
      role: r.role,
      validFrom: r.validFrom,
      validTo: r.validTo,
      active: activeIds.has(r.id),
    })),
    schedules: schedules.map((s) => ({
      id: s.id,
      validFrom: s.validFrom,
      pensumPercent: s.pensumPercent,
      minutes: {
        mon: s.minutesMon,
        tue: s.minutesTue,
        wed: s.minutesWed,
        thu: s.minutesThu,
        fri: s.minutesFri,
        sat: s.minutesSat,
        sun: s.minutesSun,
      },
    })),
    entitlements: entitlements.map((e) => ({ id: e.id, year: e.year, days: e.days, note: e.note })),
    canEditSchedules: canEditSchedule(actor, u),
    anonymizeAllowedFrom: retention.allowedFrom,
    /** First day of the current terms (null: they always applied). */
    termsFrom: timeline.currentFrom,
    earlierTerms: timeline.earlier.map((t) => ({ ...currentTerms(t), validUntil: t.validUntil })).toReversed(),
    earlierPeriods: timeline.periods
      .slice(0, -1)
      .map((p) => ({ start: p.start, end: p.end }))
      .toReversed(),
  }
}
export type UserDetail = ReturnType<typeof getUserDetail>

function hasCredential(userId: number): boolean {
  return credentialUserIds([userId]).has(userId)
}

// ------------------------------------------------------------------ create / update

export interface UserInput {
  name: string
  email: string
  role: "admin" | "employee"
  capabilities: Capability[]
  teamId: number | null
  holidayCalendarId: number | null
  timezone: string
  locale: string
  employmentStart: string | null
  employmentEnd: string | null
  vacationDaysPerYear: number
  legalWeeklyMaxHours: 45 | 50
  recordingMode: "full" | "simplified" | "waived"
  argExempt: boolean
  regularNightWork: boolean
  birthDate: string | null
  /** First day changed terms (timezone, vacation days, labour-law fields) apply on; default today. */
  termsFrom?: string | null
}

const hasControlChars = (v: string) => /\p{Cc}/u.test(v)

/** `current`: the stored employment dates (or create defaults) the patch is checked against. */
function validate(
  data: Partial<UserInput>,
  current: { employmentStart: string | null; employmentEnd: string | null } | null = null,
): void {
  const fields: Record<string, string> = {}
  if (data.name !== undefined && (!data.name.trim() || data.name.length > 120 || hasControlChars(data.name)))
    fields.name = data.name.trim() ? "invalid" : "required"
  if (data.timezone !== undefined && !isValidTz(data.timezone)) fields.timezone = "invalid"
  if (data.locale !== undefined && !isSupportedLocale(data.locale)) fields.locale = "invalid"
  if (
    data.capabilities !== undefined &&
    !data.capabilities.every((c) => (CAPABILITIES as readonly string[]).includes(c))
  )
    fields.capabilities = "invalid"
  if (data.teamId != null && !db.select({ id: teams.id }).from(teams).where(eq(teams.id, data.teamId)).get())
    fields.teamId = "invalid"
  if (
    data.holidayCalendarId != null &&
    !db
      .select({ id: holidayCalendars.id })
      .from(holidayCalendars)
      .where(eq(holidayCalendars.id, data.holidayCalendarId))
      .get()
  )
    fields.holidayCalendarId = "invalid"
  const start = data.employmentStart || current?.employmentStart
  const end = data.employmentEnd !== undefined ? data.employmentEnd || null : (current?.employmentEnd ?? null)
  if (start && end && end < start) fields.employmentEnd = "before_start"
  if (data.vacationDaysPerYear !== undefined && !(data.vacationDaysPerYear >= 0 && data.vacationDaysPerYear <= 366))
    fields.vacationDaysPerYear = "invalid"
  if (data.birthDate && data.birthDate > localToday(getSetting("default_timezone"))) fields.birthDate = "future"
  if (Object.keys(fields).length) throw new Validation("Please check your input", { fields })
}

function ensureEmailFree(email: string, exceptId?: number) {
  const clash = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
  if (clash && clash.id !== exceptId)
    throw new Conflict("Email already in use", { code: "email_taken", fields: { email: "taken" } })
}

function ensureOtherAdmin(u: User) {
  const others =
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true), sql`${users.id} <> ${u.id}`))
      .get()?.n ?? 0
  if (others === 0) throw new Conflict("At least one active administrator is required", { code: "last_admin" })
}

function defaultMinutes(pensum: number) {
  const daily = Math.round((getSetting("fulltime_weekly_minutes") / 5) * (pensum / 100))
  return { mon: daily, tue: daily, wed: daily, thu: daily, fri: daily, sat: 0, sun: 0 }
}

export function createUser(
  actor: Actor,
  input: Partial<UserInput> & { name: string; email: string; pensumPercent?: number },
): User {
  requireAdmin(actor)
  const email = normalizeEmail(input.email)
  ensureEmailFree(email)
  const tz = input.timezone || getSetting("default_timezone")
  validate(input, { employmentStart: localToday(isValidTz(tz) ? tz : "UTC"), employmentEnd: null })
  ensureNotJoiningOwnTeam(actor, input.teamId ?? null)
  const u = db
    .insert(users)
    .values({
      email,
      name: input.name.trim(),
      role: input.role ?? "employee",
      capabilities: [...new Set(input.capabilities ?? [])].sort(),
      teamId: input.teamId ?? null,
      holidayCalendarId: input.holidayCalendarId ?? null,
      timezone: tz,
      locale: input.locale || getSetting("default_locale"),
      // targets and vacation start on the employment start; unknown means today, never 1 January
      employmentStart: input.employmentStart || localToday(tz),
      employmentEnd: input.employmentEnd ?? null,
      vacationDaysPerYear: input.vacationDaysPerYear ?? getSetting("default_vacation_days"),
      legalWeeklyMaxHours: input.legalWeeklyMaxHours ?? (getSetting("weekly_max_minutes") > 2700 ? 50 : 45),
      recordingMode: input.recordingMode ?? "full",
      argExempt: input.argExempt ?? false,
      regularNightWork: input.regularNightWork ?? false,
      birthDate: input.birthDate || null,
    })
    .returning()
    .get()
  const pensum = Math.min(100, Math.max(1, input.pensumPercent ?? 100))
  const m = defaultMinutes(pensum)
  const sched = db
    .insert(workSchedules)
    .values({
      userId: u.id,
      validFrom: u.employmentStart!,
      pensumPercent: pensum,
      minutesMon: m.mon,
      minutesTue: m.tue,
      minutesWed: m.wed,
      minutesThu: m.thu,
      minutesFri: m.fri,
      minutesSat: m.sat,
      minutesSun: m.sun,
    })
    .returning()
    .get()
  record({ entity: "user", row: u, action: "create", actor, subjectUserId: u.id, before: null })
  record({ entity: "schedule", row: sched, action: "create", actor, subjectUserId: u.id, before: null })
  return u
}

const SELF_LOCKED = [
  "vacationDaysPerYear",
  "employmentStart",
  "employmentEnd",
  "legalWeeklyMaxHours",
  "recordingMode",
  "argExempt",
  "regularNightWork",
  "teamId",
  "holidayCalendarId",
] as const

const norm = (v: unknown) => (v === "" || v === undefined ? null : v)

/**
 * Widens access or changes what time and vacation count against: administrators need someone else for that on
 * their own account.
 */
function grantsOrRetargets(u: User, patch: Partial<UserInput>): boolean {
  const gainsCapability = (patch.capabilities ?? []).some((c) => !(u.capabilities ?? []).includes(c))
  const changesContract = SELF_LOCKED.some((k) => patch[k] !== undefined && norm(patch[k]) !== norm(u[k]))
  return gainsCapability || changesContract
}

/** Emails are deferred (outbox) and go out only after the transaction committed. */
export function updateUser(actor: Actor, userId: number, patch: Partial<UserInput>): User {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  if (u.anonymizedAt) throw new Conflict("This account is anonymised", { code: "already_anonymised" })
  validate(patch, u)
  if (grantsOrRetargets(u, patch))
    requireSomeoneElse(actor, u.id, "Another administrator has to change this for you", { hrExempt: false })
  const next: Partial<typeof users.$inferInsert> = {}
  let oldEmail: string | null = null
  if (patch.email !== undefined) {
    const email = normalizeEmail(patch.email)
    if (email !== u.email) {
      ensureEmailFree(email, u.id)
      oldEmail = u.email
      next.email = email
    }
  }
  const timeline = personTimeline(u)
  for (const key of ["employmentStart", "employmentEnd"] as const) {
    if (patch[key] !== undefined && (patch[key] || null) !== u[key]) {
      ensureEmploymentMoveAllowed(u, timeline, key, patch[key] || null)
      next[key] = patch[key] || null
    }
  }
  if (patch.role !== undefined && patch.role !== u.role) {
    if (patch.role === "employee") ensureOtherAdmin(u)
    next.role = patch.role
  }
  if (patch.name !== undefined) next.name = patch.name.trim()
  if (patch.capabilities !== undefined) next.capabilities = [...new Set(patch.capabilities)].sort()
  if (patch.birthDate !== undefined) next.birthDate = patch.birthDate || null
  for (const key of [
    "teamId",
    "holidayCalendarId",
    "timezone",
    "locale",
    "vacationDaysPerYear",
    "legalWeeklyMaxHours",
    "recordingMode",
    "argExempt",
    "regularNightWork",
  ] as const) {
    if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key]
  }
  if (next.teamId != null && next.teamId !== u.teamId) ensureNotJoiningOwnTeam(actor, next.teamId)
  const termsFrom = TERM_KEYS.some((k) => next[k] !== undefined && next[k] !== u[k])
    ? archiveTerms(u, patch.termsFrom ?? null, timeline)
    : null
  if (next.employmentStart) coverStartWithSchedule(actor, u, next.employmentStart)
  const before = snapshot("user", u)
  const updated = Object.keys(next).length ? db.update(users).set(next).where(eq(users.id, u.id)).returning().get() : u
  const changedSnapshot = JSON.stringify(snapshot("user", updated)) !== JSON.stringify(before)
  const changedOther =
    JSON.stringify([
      u.capabilities,
      u.locale,
      u.legalWeeklyMaxHours,
      u.recordingMode,
      u.argExempt,
      u.regularNightWork,
      u.birthDate,
    ]) !==
    JSON.stringify([
      updated.capabilities,
      updated.locale,
      updated.legalWeeklyMaxHours,
      updated.recordingMode,
      updated.argExempt,
      updated.regularNightWork,
      updated.birthDate,
    ])
  if (changedSnapshot || changedOther)
    record({
      entity: "user",
      row: updated,
      action: "update",
      actor,
      subjectUserId: u.id,
      before,
      reason: termsFrom ? `Terms from ${termsFrom}` : "",
    })
  if (oldEmail) {
    // the old mailbox may be compromised or gone: end sessions and pending links, tell the old address
    revokeAccess(u.id, { apiKeys: true })
    if (hasCredential(u.id))
      deferMail({ email: oldEmail, name: updated.name, locale: updated.locale }, "email_changed", {
        new_email: updated.email,
      })
  }
  return updated
}

/** Days whose employment status changes when `key` moves to `value` must not be signed off. */
function ensureEmploymentMoveAllowed(
  u: User,
  timeline: PersonTimeline,
  key: "employmentStart" | "employmentEnd",
  value: string | null,
): void {
  const earlier = timeline.periods.slice(0, -1)
  const lastEarlierEnd = earlier.at(-1)?.end ?? null
  if (key === "employmentStart" && value && lastEarlierEnd && value <= lastEarlierEnd)
    throw new Validation("The employment starts after the earlier employment ended", {
      fields: { employmentStart: "overlaps_earlier" },
    })
  const old = u[key]
  const [from, to] =
    key === "employmentStart"
      ? [
          minDay(old ?? "0001-01-01", value ?? "0001-01-01"),
          addDays(maxDay(old ?? "0001-01-01", value ?? "0001-01-01"), -1),
        ]
      : [
          addDays(minDay(old ?? "9999-12-30", value ?? "9999-12-30"), 1),
          maxDay(old ?? "9999-12-31", value ?? "9999-12-31"),
        ]
  if (from > to) return
  const rows = signedMonthsOverlapping(u.id, from, to)
  if (rows.length)
    throw new Conflict(`This would change the signed-off month(s) ${rows.map((r) => r.month).join(", ")}`, {
      code: "period_signed_off",
      fields: { [key]: "signed_off" },
    })
}

/** The first schedule version starts no later than the employment (a day without a schedule has no target). */
function coverStartWithSchedule(actor: Actor, u: User, start: string): void {
  const first = db
    .select()
    .from(workSchedules)
    .where(eq(workSchedules.userId, u.id))
    .orderBy(asc(workSchedules.validFrom))
    .limit(1)
    .get()
  if (!first || first.validFrom <= start) return
  const { id: _id, createdAt: _created, ...copy } = first
  const sched = db
    .insert(workSchedules)
    .values({ ...copy, validFrom: start })
    .returning()
    .get()
  record({ entity: "schedule", row: sched, action: "create", actor, subjectUserId: u.id, before: null })
}

/** Employ a former employee again from `start`: the ended period is kept, a new one begins. */
export function rehire(actor: Actor, userId: number, start: string): User {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  if (u.anonymizedAt) throw new Conflict("This account is anonymised", { code: "already_anonymised" })
  if (!u.employmentEnd || start <= u.employmentEnd)
    throw new Validation("Rehiring starts after the employment ended", { fields: { employmentStart: "before_end" } })
  requireSomeoneElse(actor, u.id, "Another administrator has to change this for you", { hrExempt: false })
  const before = snapshot("user", u)
  db.insert(employmentHistory)
    .values({ userId: u.id, startDate: u.employmentStart ?? accountStart(u), endDate: u.employmentEnd })
    .run()
  const updated = db
    .update(users)
    .set({ employmentStart: start, employmentEnd: null, isActive: true })
    .where(eq(users.id, u.id))
    .returning()
    .get()
  record({
    entity: "user",
    row: updated,
    action: "update",
    actor,
    subjectUserId: u.id,
    before,
    reason: `Rehired from ${start} (earlier employment ${u.employmentStart ?? "?"} to ${u.employmentEnd})`,
  })
  return updated
}

/** Sign out everywhere and expire pending invitation and password reset links (optionally API keys too). */
function revokeAccess(userId: number, opts: { apiKeys?: boolean; passkeys?: boolean } = {}): number {
  if (opts.passkeys) db.delete(passkey).where(eq(passkey.userId, userId)).run()
  // reset links are stored under a hash of their identifier (auth.ts), so only the value names the person
  db.delete(verification)
    .where(eq(verification.value, String(userId)))
    .run()
  db.update(authTokens)
    .set({ usedAt: utcnow() })
    .where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt)))
    .run()
  if (opts.apiKeys)
    db.update(apikey)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(apikey.referenceId, String(userId)))
      .run()
  return db.delete(session).where(eq(session.userId, userId)).run().changes
}

export function setActive(actor: Actor, userId: number, active: boolean): User {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  if (u.anonymizedAt) throw new Conflict("This account is anonymised", { code: "already_anonymised" })
  if (u.isActive === active) return u
  const before = snapshot("user", u)
  if (!active) {
    if (u.id === actor.id) throw new Conflict("You cannot deactivate yourself", { code: "self_deactivate" })
    if (u.role === "admin") ensureOtherAdmin(u)
    revokeAccess(u.id, { apiKeys: true, passkeys: true })
    stopRunning(u, actor, "Account deactivated")
    for (const row of db.select().from(teamLeads).where(eq(teamLeads.userId, u.id)).all()) {
      logLeadChange(actor, row, "delete")
      db.delete(teamLeads).where(eq(teamLeads.id, row.id)).run()
    }
  }
  const updated = db.update(users).set({ isActive: active }).where(eq(users.id, u.id)).returning().get()
  record({
    entity: "user",
    row: updated,
    action: "update",
    actor,
    subjectUserId: u.id,
    before,
    reason: active ? "Account reactivated" : "Account deactivated",
  })
  return updated
}

/** Team lead rows are not in revisions.SNAPSHOT_KEYS (v1 logged them the same way). */
export function logLeadChange(
  actor: Actor | null,
  row: typeof teamLeads.$inferSelect,
  action: "create" | "delete" | "update",
  before?: Record<string, string | number | null>,
) {
  const team = db.select({ name: teams.name }).from(teams).where(eq(teams.id, row.teamId)).get()
  const data = {
    team_id: row.teamId,
    team: team?.name ?? null,
    role: row.role,
    valid_from: row.validFrom,
    valid_to: row.validTo,
  }
  db.insert(revisions)
    .values({
      entity: "team_lead",
      entityId: row.id,
      subjectUserId: row.userId,
      actorId: actor?.id ?? null,
      action,
      before: action === "create" ? null : (before ?? data),
      after: action === "delete" ? null : data,
      reason: "",
      source: "web",
    })
    .run()
}

// ------------------------------------------------------------------ credentials

export function setPasswordByAdmin(actor: Actor, userId: number, hash: string, opts: { notify: boolean }): void {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  if (u.id === actor.id) throw new Validation("Use your profile to change your own password", { code: "use_profile" })
  if (u.anonymizedAt) throw new Conflict("This account is anonymised", { code: "already_anonymised" })
  const existing = db
    .select()
    .from(account)
    .where(and(eq(account.userId, u.id), eq(account.providerId, "credential")))
    .get()
  const now = new Date()
  if (existing) db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, existing.id)).run()
  else
    db.insert(account)
      .values({
        userId: u.id,
        accountId: String(u.id),
        providerId: "credential",
        password: hash,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  const updated = db
    .update(users)
    .set({ passwordChangedAt: utcnow(), emailVerified: true })
    .where(eq(users.id, u.id))
    .returning()
    .get()
  const revoked = revokeAccess(u.id, { apiKeys: true })
  record({
    entity: "user",
    row: updated,
    action: "password_set",
    actor,
    subjectUserId: u.id,
    before: null,
    reason: `Password set by administrator; ${revoked} sessions ended`,
  })
  notify(u.id, "password_set_by_admin", { actor_name: actor.user.name })
  if (opts.notify && u.isActive)
    deferMail({ email: u.email, name: u.name, locale: u.locale }, "password_set_by_admin", {
      actor_name: actor.user.name,
    })
}

export function resetTwoFactor(actor: Actor, userId: number): void {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  if (u.id === actor.id)
    throw new Validation("Use your profile to change your own two-factor settings", { code: "use_profile" })
  if (!u.twoFactorEnabled && !db.select({ id: twoFactor.id }).from(twoFactor).where(eq(twoFactor.userId, u.id)).get())
    throw new Conflict("Two-factor authentication is not enabled", { code: "mfa_disabled" })
  db.delete(twoFactor).where(eq(twoFactor.userId, u.id)).run()
  const updated = db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, u.id)).returning().get()
  revokeAccess(u.id)
  record({
    entity: "user",
    row: updated,
    action: "mfa_reset",
    actor,
    subjectUserId: u.id,
    before: null,
    reason: "Two-factor reset by administrator",
  })
  notify(u.id, "mfa_reset", { actor_name: actor.user.name })
  deferMail({ email: u.email, name: u.name, locale: u.locale }, "mfa_reset", { actor_name: actor.user.name })
}

/** Remove all passkeys of a person (lost device); two-factor stays as it is. */
export function removePasskeys(actor: Actor, userId: number): number {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  if (u.id === actor.id) throw new Validation("Manage your own passkeys in your profile", { code: "use_profile" })
  const removed = db.delete(passkey).where(eq(passkey.userId, u.id)).run().changes
  if (!removed) throw new Conflict("This person has no passkeys", { code: "invalid_state" })
  revokeAccess(u.id)
  record({
    entity: "user",
    row: u,
    action: "passkeys_removed",
    actor,
    subjectUserId: u.id,
    before: null,
    reason: `${removed} passkeys removed by administrator`,
  })
  notify(u.id, "passkeys_removed", { actor_name: actor.user.name, count: removed })
  return removed
}

/**
 * The person can still accept an invitation: active and never signed in. Someone who signs in with single
 * sign-on or a passkey has no password, but an invitation link (which the administrator sees) would let the
 * administrator choose one and sign in as them.
 */
export function ensureInvitable(actor: Actor, userId: number): User {
  requireAdmin(actor)
  const u = getUserOr404(userId)
  const signedInBefore =
    u.lastLoginAt != null ||
    db.select({ id: account.id }).from(account).where(eq(account.userId, u.id)).get() != null ||
    db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, u.id)).get() != null
  if (!u.isActive || u.anonymizedAt || hasCredential(u.id) || signedInBefore)
    throw new Conflict("This person has already signed in", { code: "invalid_state" })
  return u
}

// ------------------------------------------------------------------ vacation entitlements

export function setEntitlement(actor: Actor, userId: number, year: number, days: number | null, note = ""): void {
  const u = getUserOr404(userId)
  if (!actor.isAdmin && !canAdjustBalance(actor, u)) throw new NotFound("User not found")
  requireSomeoneElse(actor, u.id, "Someone else has to set your entitlement", { hrExempt: false })
  if (!Number.isInteger(year) || year < 1990 || year > 2100)
    throw new Validation("Invalid year", { fields: { year: "invalid" } })
  const row = db
    .select()
    .from(vacationEntitlements)
    .where(and(eq(vacationEntitlements.userId, u.id), eq(vacationEntitlements.year, year)))
    .get()
  if (days == null) {
    if (row) {
      record({
        entity: "entitlement",
        row,
        action: "delete",
        actor,
        subjectUserId: u.id,
        before: snapshot("entitlement", row),
        reason: note,
      })
      db.delete(vacationEntitlements).where(eq(vacationEntitlements.id, row.id)).run()
    }
    return
  }
  if (!(days >= 0 && days <= 366)) throw new Validation("Invalid number of days", { fields: { days: "invalid" } })
  const before = row ? snapshot("entitlement", row) : null
  const saved = row
    ? db
        .update(vacationEntitlements)
        .set({ days, note: note.trim().slice(0, 200) })
        .where(eq(vacationEntitlements.id, row.id))
        .returning()
        .get()
    : db
        .insert(vacationEntitlements)
        .values({ userId: u.id, year, days, note: note.trim().slice(0, 200) })
        .returning()
        .get()
  record({
    entity: "entitlement",
    row: saved,
    action: row ? "update" : "create",
    actor,
    subjectUserId: u.id,
    before,
    reason: note,
  })
}

// ------------------------------------------------------------------ history

const PROFILE_ENTITIES = ["user", "schedule", "entitlement", "team_lead"]

/** Change history of a person's profile and contract data (no time data). */
export function userHistory(actor: Actor, userId: number, limit = 200) {
  requireAdmin(actor)
  getUserOr404(userId)
  const rows = db
    .select({ r: revisions, actorName: users.name })
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.actorId))
    .where(and(eq(revisions.subjectUserId, userId), inArray(revisions.entity, PROFILE_ENTITIES)))
    .orderBy(desc(revisions.at), desc(revisions.id))
    .limit(limit)
    .all()
  return rows.map(({ r, actorName }) => {
    const changed =
      r.before && r.after
        ? Object.keys(r.after)
            .filter((k) => JSON.stringify(r.before![k]) !== JSON.stringify(r.after![k]))
            .sort()
        : []
    return {
      id: r.id,
      entity: r.entity,
      action: r.action,
      at: iso(r.at),
      actor: actorName,
      reason: r.reason,
      changed,
      before: r.before,
      after: r.after,
    }
  })
}

// ------------------------------------------------------------------ data protection

function addYears(day: string, years: number): string {
  return Temporal.PlainDate.from(day).add({ years }).toString()
}

/** Retention runs from the employment end, or from the last time record if one is dated later. */
export function retentionInfo(u: User): { allowedFrom: string | null } {
  if (!u.employmentEnd) return { allowedFrom: null }
  const lastEntry = db
    .select({ at: max(timeEntries.startAt) })
    .from(timeEntries)
    .where(eq(timeEntries.userId, u.id))
    .get()?.at
  const lastAbsence = db
    .select({ d: max(absences.endDate) })
    .from(absences)
    .where(eq(absences.userId, u.id))
    .get()?.d
  const last = [u.employmentEnd, lastEntry ? localDateOf(lastEntry, u.timezone) : null, lastAbsence]
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)!
  return { allowedFrom: addYears(last, getSetting("retention_years")) }
}

/**
 * Irreversibly remove the identity of a former employee once the retention period (ArGV 1 Art. 73,
 * `retention_years` after the employment end) is over. Time records stay; access artefacts, logs,
 * notifications and documents go. The change log is append-only and is not rewritten.
 */
export function anonymizeUser(actor: Actor, userId: number): { documentsRemoved: number } {
  requireAdmin(actor)
  return anonymize(actor, userId, "web")
}

/** Server shell (`rt anonymize`): the same rules, logged without an actor. */
export function anonymizeUserFromCli(userId: number): { documentsRemoved: number } {
  return anonymize(null, userId, "cli")
}

function anonymize(actor: Actor | null, userId: number, source: string): { documentsRemoved: number } {
  const u = getUserOr404(userId)
  if (u.anonymizedAt) throw new Conflict("This account is already anonymised", { code: "already_anonymised" })
  if (u.isActive) throw new Conflict("Deactivate the account first", { code: "still_active" })
  const { allowedFrom } = retentionInfo(u)
  if (!allowedFrom) throw new Validation("Set the employment end first", { fields: { employmentEnd: "required" } })
  if (allowedFrom > localToday(getSetting("default_timezone")))
    throw new Conflict(`The retention period runs until ${allowedFrom}`, { code: "retention", fields: { allowedFrom } })

  const docs = db
    .select({ id: attachments.id, storageName: attachments.storageName })
    .from(attachments)
    .innerJoin(absences, eq(absences.id, attachments.absenceId))
    .where(eq(absences.userId, u.id))
    .all()
  const files = docs.map((d) => path.join(env.attachmentsDir, path.basename(d.storageName))).filter(existsSync)
  const documentsRemoved = files.length
  if (docs.length)
    db.update(attachments)
      .set({ isDeleted: true, size: 0, filename: "removed" })
      .where(
        inArray(
          attachments.id,
          docs.map((d) => d.id),
        ),
      )
      .run()
  db.delete(session).where(eq(session.userId, u.id)).run()
  db.delete(account).where(eq(account.userId, u.id)).run()
  db.delete(twoFactor).where(eq(twoFactor.userId, u.id)).run()
  db.delete(passkey).where(eq(passkey.userId, u.id)).run()
  db.delete(apikey)
    .where(eq(apikey.referenceId, String(u.id)))
    .run()
  db.delete(authTokens).where(eq(authTokens.userId, u.id)).run()
  db.delete(notifications).where(eq(notifications.userId, u.id)).run()
  db.delete(loginAttempts)
    .where(or(eq(loginAttempts.userId, u.id), eq(loginAttempts.email, u.email)))
    .run()
  scrubUserRevisions(u.id, `Former employee #${u.id}`, ANON_EMAIL(u.id))
  const updated = db
    .update(users)
    .set({
      name: `Former employee #${u.id}`,
      email: ANON_EMAIL(u.id),
      image: null,
      birthDate: null,
      emailVerified: false,
      twoFactorEnabled: false,
      notifyEmailOnCorrection: false,
      anonymizedAt: utcnow(),
    })
    .where(eq(users.id, u.id))
    .returning()
    .get()
  record({
    entity: "user",
    row: updated,
    action: "anonymize",
    actor,
    subjectUserId: u.id,
    before: null,
    reason: `Personal data anonymised after the retention period; ${documentsRemoved} documents removed`,
    source,
  })
  // files last: a failing statement above rolls the transaction back with the documents still there
  for (const file of files) unlinkSync(file)
  return { documentsRemoved }
}

/**
 * revDSG erasure: replace name and email (and drop the birth date) in the person's own user-entity revisions. The append-only trigger
 * allows exactly this while app_state.revision_scrub holds the person's id (drizzle/0003_guards_v2.sql).
 */
function scrubUserRevisions(userId: number, name: string, email: string): void {
  db.insert(appState)
    .values({ key: "revision_scrub", value: String(userId) })
    .onConflictDoUpdate({ target: appState.key, set: { value: String(userId) } })
    .run()
  const rows = db
    .select()
    .from(revisions)
    .where(and(eq(revisions.entity, "user"), eq(revisions.entityId, userId)))
    .all()
  const scrub = (snap: JsonObject | null): JsonObject | null =>
    snap
      ? {
          ...snap,
          ...("name" in snap ? { name } : {}),
          ...("email" in snap ? { email } : {}),
          ...("birth_date" in snap ? { birth_date: null } : {}),
        }
      : snap
  for (const r of rows)
    db.update(revisions)
      .set({ before: scrub(r.before), after: scrub(r.after) })
      .where(eq(revisions.id, r.id))
      .run()
  db.delete(appState).where(eq(appState.key, "revision_scrub")).run()
}
