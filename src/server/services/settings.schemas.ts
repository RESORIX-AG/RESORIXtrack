/** Settings defaults and validation (client-safe: referenced by server-function validators). */
import { z } from "zod"
import { DEFAULT_LOCALE, localeSchema } from "@/lib/locales"

function isTimeZone(v: string): boolean {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: v }).resolvedOptions().timeZone !== ""
  } catch {
    return false
  }
}

export const DEFAULTS = {
  company_name: "RESORIX AG",
  default_timezone: "Europe/Zurich",
  default_locale: DEFAULT_LOCALE,
  // "scheduled": a holiday only reduces the target on the person's scheduled workday;
  // "prorata": every Mon-Fri holiday credits pensum x full-time daily minutes.
  holiday_mode: "scheduled" as "scheduled" | "prorata",
  fulltime_weekly_minutes: 2520, // 42 h
  default_vacation_days: 25,
  // Sunday and public holiday work (ArG Art. 19 para. 3): 50 % wage supplement; "payroll" only reports the
  // hours, "time_credit" credits the supplement as time (collective agreements)
  holiday_work_surcharge_percent: 50,
  holiday_work_surcharge_mode: "payroll" as "payroll" | "time_credit",
  lead_can_edit_schedules: true,
  lead_can_adjust_balances: true,
  reason_required_for_past_edits: true,
  sick_self_report_backdate_days: 3,
  sick_self_report_max_days: 30,
  clock_reminder_hours: 10,
  // ArG Art. 9: 45 h (industry, office, technical staff, large retail) or 50 h (all others)
  weekly_max_minutes: 2700 as 2700 | 3000,
  login_log_retention_days: 365,
  setup_complete: false,
  getting_started_dismissed: false,
  brand_accent: "", // "#rrggbb" or "" for the default
  mfa_required_for_admins: false,
  mfa_required_for_all: false,
  api_tokens_enabled: true,
  // projects on time entries: off | optional | required (= every work entry has a project)
  project_mode: "optional" as "off" | "optional" | "required",
  // Swiss law (docs/compliance.md)
  compliance_enabled: true,
  // refuse a clock-in before the legal minimum break (Art. 15) and daily rest (Art. 15a) are complete
  break_enforcement: true,
  night_work_permitted: false,
  sunday_work_permitted: false,
  retention_years: 5, // ArGV 1 Art. 73: at least 5 years
  privacy_notice: "", // markdown-free plain text shown on /privacy (revDSG Art. 19)
}
export type Settings = typeof DEFAULTS
export type SettingKey = keyof Settings

/**
 * Settings that change figures (targets, credits, vacation, findings). They apply from a date (`setting_versions`),
 * so a change never reaches earlier days; the database guards in drizzle/0011_dated_terms.sql list the same keys.
 */
export const VERSIONED_SETTINGS = [
  "holiday_mode",
  "fulltime_weekly_minutes",
  "holiday_work_surcharge_percent",
  "holiday_work_surcharge_mode",
  "compliance_enabled",
  "night_work_permitted",
  "sunday_work_permitted",
] as const satisfies readonly SettingKey[]
export type VersionedSetting = (typeof VERSIONED_SETTINGS)[number]

/** Keys of earlier versions that no longer apply; ignored when stored, saved or imported. */
export const RETIRED_SETTINGS: readonly string[] = [
  "session_remember_days", // SESSION_REMEMBER_DAYS in the environment
  "break_rules_enabled", // breaks (ArG Art. 15) are always checked when the ArG applies
  // projects live on the time entries: "required" means every work entry has one
  "worklog_required_percent",
  "worklog_project_required",
  "vacation_prorate_workdays", // vacation always follows the scheduled working days
]

const int = (min: number, max: number) => z.number().int().min(min).max(max)
export const settingsSchema = z.object({
  company_name: z.string().min(1).max(120),
  default_timezone: z.string().refine(isTimeZone),
  default_locale: localeSchema,
  holiday_mode: z.enum(["scheduled", "prorata"]),
  fulltime_weekly_minutes: int(60, 6000),
  default_vacation_days: z.number().min(0).max(366),
  holiday_work_surcharge_percent: z.number().min(0).max(200),
  holiday_work_surcharge_mode: z.enum(["payroll", "time_credit"]),
  lead_can_edit_schedules: z.boolean(),
  lead_can_adjust_balances: z.boolean(),
  reason_required_for_past_edits: z.boolean(),
  sick_self_report_backdate_days: int(0, 60),
  sick_self_report_max_days: int(1, 365),
  clock_reminder_hours: int(0, 24),
  weekly_max_minutes: z.union([z.literal(2700), z.literal(3000)]),
  login_log_retention_days: int(30, 3650),
  setup_complete: z.boolean(),
  getting_started_dismissed: z.boolean(),
  brand_accent: z.string().regex(/^(#[0-9a-f]{6})?$/),
  mfa_required_for_admins: z.boolean(),
  mfa_required_for_all: z.boolean(),
  api_tokens_enabled: z.boolean(),
  project_mode: z.enum(["off", "optional", "required"]),
  compliance_enabled: z.boolean(),
  break_enforcement: z.boolean(),
  night_work_permitted: z.boolean(),
  sunday_work_permitted: z.boolean(),
  retention_years: int(5, 30),
  privacy_notice: z.string().max(20000),
}) satisfies z.ZodType<Settings>
