/**
 * Administration of company settings: grouped settings, branding (logos, accent colour), SMTP status,
 * absence types and the getting-started checklist. Administrators only.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { and, count, eq, ne, notExists, sql } from "drizzle-orm"
import { db } from "../db"
import {
  type AbsenceCategory,
  absences,
  absenceTypes,
  holidayCalendars,
  holidays,
  settings as settingsTable,
  teams,
  users,
  workSchedules,
} from "../db/schema"
import { env } from "../env"
import { Conflict, NotFound, Validation } from "../errors"
import { serializeAbsenceType } from "./absence-types"
import { type Actor, activeLeadRows, requireAdmin } from "./permissions"
import { getAllSettings, RETIRED_SETTINGS, type SettingKey, type Settings, updateSettings } from "./settings"

export { MAX_LOGO_BYTES } from "./admin-settings.schemas"

import { MAX_LOGO_BYTES } from "./admin-settings.schemas"

// ------------------------------------------------------------------ settings

export const SETTING_GROUPS = {
  company: ["company_name", "default_timezone", "default_locale"],
  time: [
    "fulltime_weekly_minutes",
    "holiday_mode",
    "default_vacation_days",
    "lead_can_edit_schedules",
    "lead_can_adjust_balances",
    "reason_required_for_past_edits",
    "sick_self_report_backdate_days",
    "sick_self_report_max_days",
    "clock_reminder_hours",
  ],
  compliance: [
    "compliance_enabled",
    "break_enforcement",
    "weekly_max_minutes",
    "night_work_permitted",
    "sunday_work_permitted",
    "holiday_work_surcharge_percent",
    "holiday_work_surcharge_mode",
    "retention_years",
  ],
  projects: ["project_mode"],
  security: ["mfa_required_for_admins", "mfa_required_for_all", "api_tokens_enabled", "login_log_retention_days"],
  privacy: ["privacy_notice"],
} as const satisfies Record<string, readonly SettingKey[]>
export type SettingGroup = keyof typeof SETTING_GROUPS

const EDITABLE = new Set<string>(Object.values(SETTING_GROUPS).flat())

export function getSettings(actor: Actor): Settings {
  requireAdmin(actor)
  return getAllSettings()
}

export function saveSettings(actor: Actor, changes: Partial<Settings>, validFrom?: string): Settings {
  requireAdmin(actor)
  const unknown = Object.keys(changes).filter((k) => !EDITABLE.has(k) && !RETIRED_SETTINGS.includes(k))
  if (unknown.length)
    throw new Validation("Unknown setting", { fields: Object.fromEntries(unknown.map((k) => [k, "invalid"])) })
  return updateSettings(changes, { validFrom })
}

// ------------------------------------------------------------------ branding

export const LOGO_VARIANTS = ["dark", "light"] as const
export type LogoVariant = (typeof LOGO_VARIANTS)[number]
const LOGO_EXTS = ["svg", "png", "webp"] as const

function customLogo(variant: LogoVariant): string | null {
  for (const ext of LOGO_EXTS) {
    const p = path.join(env.brandingDir, `logo-${variant}.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}

function logoInfo(variant: LogoVariant): { custom: boolean; url: string } {
  const p = customLogo(variant)
  return { custom: p != null, url: `/branding/logo/${variant}?v=${p ? Math.floor(statSync(p).mtimeMs) : 0}` }
}

export function brandingInfo() {
  const logos: Record<LogoVariant, { custom: boolean; url: string }> = {
    dark: logoInfo("dark"),
    light: logoInfo("light"),
  }
  return { accent: getAllSettings().brand_accent, defaultAccent: "#35a1cc", logos }
}

function sniff(data: Buffer): (typeof LOGO_EXTS)[number] {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP")
    return "webp"
  const head = data.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase()
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) return "svg"
  throw new Validation("Only SVG, PNG or WebP logos are supported", { fields: { file: "type" } })
}

const unsafeSvg = (why: string) => new Validation(`Unsafe SVG: ${why}`, { fields: { file: "not_allowed" } })

/** Reject SVG content that could run code or load remote resources (it is also served with a sandbox CSP). */
export function checkSvg(text: string): void {
  const lower = text.toLowerCase()
  if (!/<svg[\s>]/.test(lower)) throw new Validation("Not an SVG image", { fields: { file: "type" } })
  if (lower.includes("<!doctype") || lower.includes("<!entity")) throw unsafeSvg("DOCTYPE or entities")
  // any namespace prefix, e.g. <x:script xmlns:x="http://www.w3.org/2000/svg">
  if (
    /<\s*([\w.-]+:)?(script|foreignobject|iframe|embed|object|audio|video|animate\w*|set|handler|listener)[\s/>]/.test(
      lower,
    )
  )
    throw unsafeSvg("active element")
  if (/\son[a-z]+\s*=/.test(lower)) throw unsafeSvg("event handler")
  for (const m of lower.matchAll(/(?:[\w.-]+:)?href\s*=\s*["']([^"']*)["']/g)) {
    if (!m[1].trim().startsWith("#") && !m[1].trim().startsWith("data:image/")) throw unsafeSvg("external link")
  }
  if (/url\s*\(\s*["']?\s*(?!#)/.test(lower) || lower.includes("@import") || lower.includes("expression("))
    throw unsafeSvg("external style")
}

export function saveLogo(actor: Actor, variant: LogoVariant, data: Buffer) {
  requireAdmin(actor)
  if (!LOGO_VARIANTS.includes(variant)) throw new NotFound("Unknown logo variant")
  if (!data.length) throw new Validation("The file is empty", { fields: { file: "empty" } })
  if (data.length > MAX_LOGO_BYTES)
    throw new Validation("The logo must be at most 1 MB", { fields: { file: "too_large" } })
  const ext = sniff(data)
  if (ext === "svg") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data)
    checkSvg(text)
  }
  mkdirSync(env.brandingDir, { recursive: true })
  removeLogoFiles(variant)
  const target = path.join(env.brandingDir, `logo-${variant}.${ext}`)
  writeFileSync(`${target}.tmp`, data)
  renameSync(`${target}.tmp`, target)
  return brandingInfo()
}

function removeLogoFiles(variant: LogoVariant): boolean {
  if (!existsSync(env.brandingDir)) return false
  let found = false
  for (const f of readdirSync(env.brandingDir)) {
    if (new RegExp(`^logo-${variant}\\.(svg|png|webp)$`).test(f)) {
      unlinkSync(path.join(env.brandingDir, f))
      found = true
    }
  }
  return found
}

export function deleteLogo(actor: Actor, variant: LogoVariant) {
  requireAdmin(actor)
  if (!LOGO_VARIANTS.includes(variant)) throw new NotFound("Unknown logo variant")
  removeLogoFiles(variant)
  return brandingInfo()
}

export function setAccent(actor: Actor, accent: string) {
  requireAdmin(actor)
  updateSettings({ brand_accent: accent.trim().toLowerCase() })
  return brandingInfo()
}

// ------------------------------------------------------------------ email

export function smtpStatus() {
  const s = env.smtp
  return { configured: Boolean(s.host), host: s.host, port: s.port, security: s.security, user: s.user, from: s.from }
}

// ------------------------------------------------------------------ absence types

const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/
const COLOR_RE = /^#[0-9a-f]{6}$/

export interface AbsenceTypeInput {
  label: string
  color: string
  category: AbsenceCategory
  creditsTime: boolean
  deductsVacation: boolean
  requiresApproval: boolean
  allowsAttachments: boolean
  employeeCanRequest: boolean
  isActive: boolean
  sort: number
}

export function listAbsenceTypesAdmin(actor: Actor) {
  requireAdmin(actor)
  const used = new Map(
    db
      .select({ id: absences.typeId, n: count() })
      .from(absences)
      .groupBy(absences.typeId)
      .all()
      .map((r) => [r.id, r.n]),
  )
  return db
    .select()
    .from(absenceTypes)
    .orderBy(absenceTypes.sort, absenceTypes.id)
    .all()
    .map((t) => Object.assign(serializeAbsenceType(t), { usage: used.get(t.id) ?? 0 }))
}

function validateType(input: Partial<AbsenceTypeInput>) {
  const fields: Record<string, string> = {}
  if (input.label !== undefined && (!input.label.trim() || input.label.length > 80))
    fields.label = input.label.trim() ? "too_long" : "required"
  if (input.color !== undefined && !COLOR_RE.test(input.color)) fields.color = "invalid"
  if (input.category !== undefined && !["vacation", "sick", "other"].includes(input.category))
    fields.category = "invalid"
  if (input.sort !== undefined && !(Number.isInteger(input.sort) && input.sort >= 0 && input.sort <= 10000))
    fields.sort = "invalid"
  if (Object.keys(fields).length) throw new Validation("Please check your input", { fields })
}

export function createAbsenceType(actor: Actor, input: AbsenceTypeInput & { key: string }) {
  requireAdmin(actor)
  const key = input.key.trim().toLowerCase()
  if (!KEY_RE.test(key)) throw new Validation("Invalid key", { fields: { key: "invalid" } })
  if (db.select({ id: absenceTypes.id }).from(absenceTypes).where(eq(absenceTypes.key, key)).get())
    throw new Conflict("Key already in use", { fields: { key: "taken" } })
  validateType(input)
  const { key: _ignored, ...rest } = input
  return serializeAbsenceType(
    db
      .insert(absenceTypes)
      .values({ ...rest, key, label: input.label.trim() })
      .returning()
      .get(),
  )
}

/** The key is immutable (it links translations, imports and the API). */
export function updateAbsenceType(actor: Actor, id: number, input: Partial<AbsenceTypeInput>) {
  requireAdmin(actor)
  const t = db.select().from(absenceTypes).where(eq(absenceTypes.id, id)).get()
  if (!t) throw new NotFound("Absence type not found")
  validateType(input)
  // past absences (signed months, team calendar privacy) were counted and shown by these
  const counting = (["category", "creditsTime", "deductsVacation"] as const).some(
    (k) => input[k] !== undefined && input[k] !== t[k],
  )
  if (counting && db.select({ id: absences.id }).from(absences).where(eq(absences.typeId, t.id)).get())
    throw new Conflict("This type is in use; create a new type instead", { code: "type_in_use_counting" })
  const next = { ...input, ...(input.label !== undefined ? { label: input.label.trim() } : {}) }
  return serializeAbsenceType(db.update(absenceTypes).set(next).where(eq(absenceTypes.id, t.id)).returning().get())
}

export function deleteAbsenceType(actor: Actor, id: number): void {
  requireAdmin(actor)
  const t = db.select().from(absenceTypes).where(eq(absenceTypes.id, id)).get()
  if (!t) throw new NotFound("Absence type not found")
  if (db.select({ id: absences.id }).from(absences).where(eq(absences.typeId, t.id)).get())
    throw new Conflict("This type is in use; deactivate it instead", { code: "type_in_use" })
  db.delete(absenceTypes).where(eq(absenceTypes.id, t.id)).run()
}

// ------------------------------------------------------------------ getting started

export function gettingStarted(actor: Actor) {
  requireAdmin(actor)
  const s = getAllSettings()
  const companySaved =
    db.select({ k: settingsTable.key }).from(settingsTable).where(eq(settingsTable.key, "company_name")).get() != null
  const defaultCal = db
    .select({ id: holidayCalendars.id })
    .from(holidayCalendars)
    .where(eq(holidayCalendars.isDefault, true))
    .get()
  const holidayCount = defaultCal
    ? (db.select({ n: count() }).from(holidays).where(eq(holidays.calendarId, defaultCal.id)).get()?.n ?? 0)
    : 0
  const teamCount = db.select({ n: count() }).from(teams).get()?.n ?? 0
  const ledTeams = new Set(activeLeadRows().map((r) => r.teamId)).size
  const people =
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.isActive, true), ne(users.id, actor.id)))
      .get()?.n ?? 0
  const withoutSchedule =
    db
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          notExists(db.select({ x: sql`1` }).from(workSchedules).where(eq(workSchedules.userId, users.id))),
        ),
      )
      .get()?.n ?? 0
  const steps = [
    { key: "company", done: companySaved && s.company_name.trim() !== "", to: "/admin/settings" },
    { key: "holidays", done: holidayCount > 0, to: "/admin/holidays", count: holidayCount },
    { key: "teams", done: teamCount > 0 && ledTeams > 0, to: "/admin/teams", count: teamCount },
    { key: "people", done: people > 0, to: "/admin/users", count: people },
    { key: "schedules", done: people > 0 && withoutSchedule === 0, to: "/admin/users" },
    { key: "smtp", done: smtpStatus().configured, to: "/admin/settings" },
  ]
  return { dismissed: s.getting_started_dismissed, steps, done: steps.filter((x) => x.done).length }
}

export function dismissGettingStarted(actor: Actor, dismissed = true): void {
  requireAdmin(actor)
  updateSettings({ getting_started_dismissed: dismissed })
}
