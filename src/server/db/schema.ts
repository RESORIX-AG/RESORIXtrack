/**
 * Database schema (Drizzle, SQLite). Column names are snake_case (drizzle `casing: "snake_case"`).
 *
 * Better Auth owns `session`, `account`, `verification`, `two_factor` and
 * `apikey`; its user model is mapped onto `users`.
 *
 * Signed-off months are additionally protected by SQLite triggers (drizzle/0001_guards.sql).
 */
import { sql } from "drizzle-orm"
import { type AnySQLiteColumn, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Json, JsonObject } from "@/lib/json"
import { instant } from "./columns"

const nowInstant = sql`(strftime('%Y-%m-%dT%H:%M:%f000Z', 'now'))`
const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export type Weekday = (typeof WEEKDAYS)[number]
export const CAPABILITIES = ["hr", "projects"] as const
export type Capability = (typeof CAPABILITIES)[number]
export type Role = "admin" | "employee"

// ------------------------------------------------------------------ people & organisation

export const users = sqliteTable(
  "users",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    email: text().notNull().unique(),
    name: text().notNull(),
    // Better Auth core fields
    emailVerified: integer({ mode: "boolean" }).notNull().default(false),
    image: text(),
    twoFactorEnabled: integer({ mode: "boolean" }).default(false),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
    // domain
    role: text().$type<Role>().notNull().default("employee"),
    teamId: integer().references(() => teams.id, { onDelete: "set null" }),
    holidayCalendarId: integer().references(() => holidayCalendars.id, { onDelete: "set null" }),
    timezone: text().notNull().default("Europe/Zurich"),
    locale: text().notNull().default("en"),
    timeFormat: text().$type<"24h" | "12h">().notNull().default("24h"),
    employmentStart: text(),
    employmentEnd: text(),
    vacationDaysPerYear: real().notNull().default(25),
    passwordChangedAt: instant(),
    isActive: integer({ mode: "boolean" }).notNull().default(true),
    notifyEmailOnCorrection: integer({ mode: "boolean" }).notNull().default(true),
    capabilities: text({ mode: "json" }).$type<Capability[]>().notNull().default(sql`'[]'`),
    lastLoginAt: instant(),
    // Swiss labour law (ArG Art. 9): legal weekly maximum 45 h (industry, office, technical staff, large retail)
    // or 50 h (all other employees). Drives the Überzeit (overtime beyond the legal maximum) checks.
    legalWeeklyMaxHours: integer().$type<45 | 50>().notNull().default(45),
    // Time recording mode (ArGV 1 Art. 73 / 73a / 73b): full (start, end, breaks), simplified (daily total
    // only, by agreement), waived (by collective agreement, income threshold). Only "full" may skip nothing.
    recordingMode: text().$type<"full" | "simplified" | "waived">().notNull().default("full"),
    // senior executive (ArG Art. 3 lit. d): the Labour Act does not apply, so no compliance checks run
    argExempt: integer({ mode: "boolean" }).notNull().default(false),
    // regular night work (ArG Art. 17b para. 2): 10 % of the night minutes (23:00-06:00) credited as time
    regularNightWork: integer({ mode: "boolean" }).notNull().default(false),
    // date of birth is optional and only used for the minimum vacation entitlement (OR 329a: 5 weeks until 20)
    birthDate: text(),
    anonymizedAt: instant(),
  },
  (t) => [
    index("ix_users_team").on(t.teamId),
    index("ix_users_active_name").on(t.isActive, t.name),
    index("ix_users_calendar").on(t.holidayCalendarId),
  ],
)

/**
 * Earlier terms of a person: the values that applied up to and including `validUntil`. The columns on `users`
 * hold the terms from the day after the latest `validUntil` on, so a change never rewrites earlier days.
 */
export const userTermsHistory = sqliteTable(
  "user_terms_history",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    validUntil: text().notNull(),
    timezone: text().notNull(),
    vacationDaysPerYear: real().notNull(),
    legalWeeklyMaxHours: integer().$type<45 | 50>().notNull(),
    recordingMode: text().$type<"full" | "simplified" | "waived">().notNull(),
    argExempt: integer({ mode: "boolean" }).notNull(),
    regularNightWork: integer({ mode: "boolean" }).notNull(),
    // plain ids (no foreign keys): deleting a team or calendar must not rewrite earlier days
    teamId: integer(),
    /** The calendar that applied (own, team's or company default), resolved when the row was kept. */
    holidayCalendarId: integer(),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [
    uniqueIndex("uq_user_terms_history_until").on(t.userId, t.validUntil),
    index("ix_user_terms_history_calendar").on(t.holidayCalendarId),
  ],
)

/** Earlier employment periods (rehiring); `users.employment_start/end` is the current one. */
export const employmentHistory = sqliteTable(
  "employment_history",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: text().notNull(),
    endDate: text().notNull(),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [uniqueIndex("uq_employment_history_start").on(t.userId, t.startDate)],
)

export const teams = sqliteTable("teams", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  color: text().notNull().default("#35a1cc"),
  holidayCalendarId: integer().references(() => holidayCalendars.id, { onDelete: "set null" }),
  createdAt: instant().notNull().default(nowInstant),
})

/** A team lead or deputy (Stellvertreter), optionally limited to a period. */
export const teamLeads = sqliteTable(
  "team_leads",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    teamId: integer()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().$type<"lead" | "deputy">().notNull().default("lead"),
    validFrom: text(),
    validTo: text(),
    createdById: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [index("ix_team_leads_team_user").on(t.teamId, t.userId), index("ix_team_leads_user").on(t.userId)],
)

/** Versioned contract data: valid from `validFrom` until the next schedule starts. */
export const workSchedules = sqliteTable(
  "work_schedules",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    validFrom: text().notNull(),
    pensumPercent: real().notNull().default(100),
    minutesMon: integer().notNull().default(0),
    minutesTue: integer().notNull().default(0),
    minutesWed: integer().notNull().default(0),
    minutesThu: integer().notNull().default(0),
    minutesFri: integer().notNull().default(0),
    minutesSat: integer().notNull().default(0),
    minutesSun: integer().notNull().default(0),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [uniqueIndex("uq_work_schedules_user_from").on(t.userId, t.validFrom)],
)

// ------------------------------------------------------------------ time data

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "break" only on legacy rows: a break is a clock-out (migration 0006 retires old break entries)
    kind: text().$type<"work" | "break">().notNull().default("work"),
    startAt: instant().notNull(),
    endAt: instant(),
    // "Clock out later": while set, the open entry is closed at this time (worker, or the next clock request)
    scheduledEndAt: instant(),
    tz: text().notNull().default("Europe/Zurich"),
    note: text().notNull().default(""),
    // what the time was spent on (company setting `project_mode`)
    projectId: integer().references((): AnySQLiteColumn => projects.id, { onDelete: "set null" }),
    source: text().$type<"clock" | "manual" | "api" | "desktop" | "offline">().notNull().default("clock"),
    isDeleted: integer({ mode: "boolean" }).notNull().default(false),
    createdById: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: instant().notNull().default(nowInstant),
    updatedAt: instant().notNull().default(nowInstant),
  },
  (t) => [
    index("ix_time_entries_user_start").on(t.userId, t.startAt),
    index("ix_time_entries_start").on(t.startAt),
    index("ix_time_entries_project_start").on(t.projectId, t.startAt),
    // at most one running entry per person, even under concurrent clock-in requests
    uniqueIndex("uq_time_entries_open").on(t.userId).where(sql`end_at IS NULL AND is_deleted = 0`),
  ],
)

/** Immutable change log of all time-relevant data (append-only, enforced by triggers). */
export const revisions = sqliteTable(
  "revisions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    entity: text().notNull(),
    entityId: integer().notNull(),
    subjectUserId: integer().references(() => users.id, { onDelete: "set null" }),
    actorId: integer().references(() => users.id, { onDelete: "set null" }),
    action: text().notNull(),
    before: text({ mode: "json" }).$type<JsonObject | null>(),
    after: text({ mode: "json" }).$type<JsonObject | null>(),
    reason: text().notNull().default(""),
    source: text().notNull().default("web"),
    at: instant().notNull().default(nowInstant),
  },
  (t) => [
    index("ix_revisions_entity").on(t.entity, t.entityId),
    index("ix_revisions_subject_at").on(t.subjectUserId, t.at),
    index("ix_revisions_at").on(t.at),
  ],
)

export const holidayCalendars = sqliteTable("holiday_calendars", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  regionCode: text().notNull().default(""),
  /** the preset's ticked optional and commune days, by English name (holiday-presets.ts) */
  presetDays: text({ mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  description: text().notNull().default(""),
  isDefault: integer({ mode: "boolean" }).notNull().default(false),
  createdAt: instant().notNull().default(nowInstant),
})

export const holidays = sqliteTable(
  "holidays",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    calendarId: integer()
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: "cascade" }),
    date: text().notNull(),
    name: text().notNull(),
    fraction: real().notNull().default(1), // 1 full day, 0.5 half day
  },
  (t) => [uniqueIndex("uq_holidays_calendar_date").on(t.calendarId, t.date), index("ix_holidays_date").on(t.date)],
)

export type AbsenceCategory = "vacation" | "sick" | "other"
export const absenceTypes = sqliteTable("absence_types", {
  id: integer().primaryKey({ autoIncrement: true }),
  key: text().notNull().unique(),
  label: text().notNull(),
  color: text().notNull().default("#8a8d93"),
  category: text().$type<AbsenceCategory>().notNull().default("other"),
  creditsTime: integer({ mode: "boolean" }).notNull().default(true),
  deductsVacation: integer({ mode: "boolean" }).notNull().default(false),
  requiresApproval: integer({ mode: "boolean" }).notNull().default(true),
  allowsAttachments: integer({ mode: "boolean" }).notNull().default(false),
  employeeCanRequest: integer({ mode: "boolean" }).notNull().default(true),
  isActive: integer({ mode: "boolean" }).notNull().default(true),
  sort: integer().notNull().default(100),
})

export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled"
export type HalfDay = "full" | "am" | "pm"
export const absences = sqliteTable(
  "absences",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    typeId: integer()
      .notNull()
      .references(() => absenceTypes.id),
    startDate: text().notNull(),
    endDate: text().notNull(),
    // single day: startHalf in {full, am, pm}; multi-day: startHalf in {full, pm}, endHalf in {full, am}
    startHalf: text().$type<HalfDay>().notNull().default("full"),
    endHalf: text().$type<HalfDay>().notNull().default("full"),
    note: text().notNull().default(""),
    status: text().$type<AbsenceStatus>().notNull().default("pending"),
    requestedById: integer().references(() => users.id, { onDelete: "set null" }),
    decidedById: integer().references(() => users.id, { onDelete: "set null" }),
    decidedAt: instant(),
    decisionNote: text().notNull().default(""),
    cancelledById: integer().references(() => users.id, { onDelete: "set null" }),
    cancelledAt: instant(),
    cancelReason: text().notNull().default(""),
    createdAt: instant().notNull().default(nowInstant),
    updatedAt: instant().notNull().default(nowInstant),
  },
  (t) => [
    index("ix_absences_user_dates").on(t.userId, t.startDate, t.endDate),
    index("ix_absences_dates").on(t.startDate, t.endDate),
    index("ix_absences_pending").on(t.userId).where(sql`status = 'pending'`),
  ],
)

export const attachments = sqliteTable(
  "attachments",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    absenceId: integer()
      .notNull()
      .references(() => absences.id, { onDelete: "cascade" }),
    filename: text().notNull(),
    contentType: text().notNull(),
    size: integer().notNull(),
    sha256: text().notNull(),
    storageName: text().notNull().unique(),
    uploadedById: integer().references(() => users.id, { onDelete: "set null" }),
    isDeleted: integer({ mode: "boolean" }).notNull().default(false),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [index("ix_attachments_absence").on(t.absenceId)],
)

/** Per-year override of `users.vacationDaysPerYear`. */
export const vacationEntitlements = sqliteTable(
  "vacation_entitlements",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    year: integer().notNull(),
    days: real().notNull(),
    note: text().notNull().default(""),
  },
  (t) => [uniqueIndex("uq_vacation_entitlements_user_year").on(t.userId, t.year)],
)

export const balanceAdjustments = sqliteTable(
  "balance_adjustments",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    account: text().$type<"time" | "vacation">().notNull(), // time: minutes, vacation: days
    amount: real().notNull(),
    effectiveDate: text().notNull(),
    kind: text().$type<"opening" | "payout" | "correction">().notNull().default("correction"),
    reason: text().notNull(),
    isDeleted: integer({ mode: "boolean" }).notNull().default(false),
    createdById: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [index("ix_balance_adjustments_user_date").on(t.userId, t.effectiveDate)],
)

/**
 * A month of one person's time data, signed off. While active (`reopenedAt IS NULL`) all time data of the
 * person in the period is immutable (services + triggers). `digest` fingerprints the data, `seal` is an
 * HMAC chained to the previous sign-off of that person, both over RFC 8785 canonical JSON (services/seals.ts).
 */
export const monthSignoffs = sqliteTable(
  "month_signoffs",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    month: text().notNull(), // YYYY-MM in the person's timezone
    periodStartDate: text().notNull(),
    periodEndDate: text().notNull(),
    periodStartUtc: instant().notNull(),
    periodEndUtc: instant().notNull(), // exclusive
    signedById: integer().references(() => users.id, { onDelete: "set null" }),
    signedAt: instant().notNull().default(nowInstant),
    note: text().notNull().default(""),
    /** JSON text exactly as sealed. */
    snapshot: text().notNull().default("{}"),
    digest: text().notNull(),
    prevSeal: text().notNull().default(""),
    seal: text().notNull(),
    sealVersion: integer().notNull().default(2),
    reopenedAt: instant(),
    reopenedById: integer().references(() => users.id, { onDelete: "set null" }),
    reopenReason: text().notNull().default(""),
    /** Holiday calendar the month was counted with; its days keep using it whatever is assigned later. */
    calendarId: integer(),
  },
  (t) => [
    index("ix_month_signoffs_user_month").on(t.userId, t.month),
    uniqueIndex("uq_month_signoffs_active").on(t.userId, t.month).where(sql`reopened_at IS NULL`),
  ],
)

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    payload: text({ mode: "json" }).$type<JsonObject>().notNull().default(sql`'{}'`),
    readAt: instant(),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [
    index("ix_notifications_user_created").on(t.userId, t.createdAt),
    index("ix_notifications_user_unread").on(t.userId).where(sql`read_at IS NULL`),
  ],
)

/** One-time email tokens for invitations (password resets use Better Auth's verification table). */
export const authTokens = sqliteTable(
  "auth_tokens",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text().$type<"invite">().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: instant().notNull(),
    usedAt: instant(),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [index("ix_auth_tokens_user").on(t.userId)],
)

/** Security log of every sign-in attempt (successful and failed). */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    email: text().notNull(),
    userId: integer().references(() => users.id, { onDelete: "set null" }),
    ip: text().notNull().default(""),
    userAgent: text().notNull().default(""),
    success: integer({ mode: "boolean" }).notNull().default(false),
    // ok | invite | reset | setup | invalid_password | unknown_user | inactive | throttled | reset_requested | mfa_failed
    reason: text().notNull().default(""),
    at: instant().notNull().default(nowInstant),
  },
  (t) => [
    index("ix_login_attempts_email_at").on(t.email, t.at),
    index("ix_login_attempts_user").on(t.userId),
    index("ix_login_attempts_at").on(t.at),
  ],
)

export const projects = sqliteTable(
  "projects",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    code: text().notNull().default(""),
    color: text().notNull().default("#35a1cc"),
    description: text().notNull().default(""),
    teamId: integer().references(() => teams.id, { onDelete: "set null" }),
    isActive: integer({ mode: "boolean" }).notNull().default(true),
    createdById: integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: instant().notNull().default(nowInstant),
    updatedAt: instant().notNull().default(nowInstant),
  },
  (t) => [index("ix_projects_team").on(t.teamId)],
)

/** Company settings: for the keys that change figures (settings.VERSIONED_SETTINGS) the value before any version. */
export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).$type<Json>(),
})

/** A figure-changing setting from `validFrom` on (until the next version of the same key). */
export const settingVersions = sqliteTable(
  "setting_versions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    key: text().notNull(),
    validFrom: text().notNull(),
    value: text({ mode: "json" }).$type<Json>(),
    createdAt: instant().notNull().default(nowInstant),
  },
  (t) => [uniqueIndex("uq_setting_versions_key_from").on(t.key, t.validFrom)],
)

/** Small key/value store for runtime state (worker heartbeat, setup code hash, last backup). */
export const appState = sqliteTable("app_state", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: instant().notNull().default(nowInstant),
})

// ------------------------------------------------------------------ Better Auth

export const session = sqliteTable(
  "session",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    token: text().notNull().unique(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: text(),
    userAgent: text(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "don't remember me": decided when the session is created, never by a cookie the client sends later
    short: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
)

export const account = sqliteTable(
  "account",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    scope: text(),
    password: text(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
)

export const verification = sqliteTable(
  "verification",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
)

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: integer({ mode: "boolean" }).default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: integer({ mode: "timestamp_ms" }),
  },
  (t) => [index("twoFactor_secret_idx").on(t.secret), index("twoFactor_userId_idx").on(t.userId)],
)

export const apikey = sqliteTable(
  "apikey",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    configId: text().notNull().default("default"),
    name: text(),
    start: text(),
    referenceId: text().notNull(),
    prefix: text(),
    key: text().notNull(),
    refillInterval: integer(),
    refillAmount: integer(),
    lastRefillAt: integer({ mode: "timestamp_ms" }),
    enabled: integer({ mode: "boolean" }).default(true),
    rateLimitEnabled: integer({ mode: "boolean" }).default(true),
    rateLimitTimeWindow: integer().default(86400000),
    rateLimitMax: integer().default(10),
    requestCount: integer().default(0),
    remaining: integer(),
    lastRequest: integer({ mode: "timestamp_ms" }),
    expiresAt: integer({ mode: "timestamp_ms" }),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
    permissions: text(),
    metadata: text(),
  },
  (t) => [
    index("apikey_configId_idx").on(t.configId),
    index("apikey_referenceId_idx").on(t.referenceId),
    index("apikey_key_idx").on(t.key),
  ],
)

export const passkey = sqliteTable(
  "passkey",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text(),
    publicKey: text().notNull(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer().notNull(),
    deviceType: text().notNull(),
    backedUp: integer({ mode: "boolean" }).notNull(),
    transports: text(),
    createdAt: integer({ mode: "timestamp_ms" }),
    aaguid: text(),
  },
  (t) => [index("passkey_userId_idx").on(t.userId), uniqueIndex("passkey_credentialID_idx").on(t.credentialID)],
)

export type User = typeof users.$inferSelect
export type Team = typeof teams.$inferSelect
export type TeamLead = typeof teamLeads.$inferSelect
export type WorkSchedule = typeof workSchedules.$inferSelect
export type TimeEntry = typeof timeEntries.$inferSelect
export type Revision = typeof revisions.$inferSelect
export type HolidayCalendar = typeof holidayCalendars.$inferSelect
export type Holiday = typeof holidays.$inferSelect
export type AbsenceType = typeof absenceTypes.$inferSelect
export type Absence = typeof absences.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type VacationEntitlement = typeof vacationEntitlements.$inferSelect
export type BalanceAdjustment = typeof balanceAdjustments.$inferSelect
export type MonthSignoff = typeof monthSignoffs.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type LoginAttempt = typeof loginAttempts.$inferSelect
export type Project = typeof projects.$inferSelect
