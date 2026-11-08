/**
 * Email rendering: kind + locale + vars -> subject, plain text and branded HTML. No remote resources: the
 * logo travels as a CID attachment (`cid:logo`), styles are inline. Vars are the JSON the caller passed to
 * `queueMail` (contract per kind in `MAIL_KINDS`).
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { dateFormat } from "@/lib/format"
import { isOneOf } from "@/lib/guards"
import type { JsonObject } from "@/lib/json"
import { DEFAULT_LOCALE, intlLocale, isSupportedLocale } from "@/lib/locales"
import { env } from "../env"
import { DEFAULT_EMAIL_LOGO_PNG } from "./default-logo"
import { MAIL_STRINGS, type MailKey, type MailStrings } from "./strings"

export const MAIL_KINDS = [
  "invite", // url, days, actorName?
  "password_reset", // url, minutes
  "password_changed",
  "passkey_added",
  "password_set_by_admin", // actorName
  "email_changed", // newEmail, actorName?
  "entry_corrected", // actorName, action (create|update|delete), date, start (HH:MM), end?, reason?
  "entry_disputed", // actorName, date, message, path?
  "absence_requested", // requesterName, typeKey?, typeLabel?, start, end, days, note?
  "absence_reported", // requesterName, typeKey?, typeLabel?, start, end, days
  "absence_recorded", // actorName, typeKey?, typeLabel?, start, end, days, allowsAttachments?
  "absence_approved", // actorName, typeKey?, typeLabel?, start, end, days, note?
  "absence_rejected", // actorName, typeKey?, typeLabel?, start, end, note?
  "absence_cancelled", // actorName, typeKey?, typeLabel?, start, end, reason?
  "absence_changed", // actorName, typeKey?, typeLabel?, start, end, reason?
  "clock_reminder", // since (instant), hours, tz?
  "test",
  "month_signed_off", // actorName, month (YYYY-MM)
  "mfa_reset", // actorName
] as const
export type MailKind = (typeof MAIL_KINDS)[number]

export interface RenderContext {
  company: string
  accent: string
  baseUrl: string
  hasLogo: boolean
}

export interface RenderedMail {
  subject: string
  text: string
  html: string
}

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""))
}

const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : ""

const pluralRules = new Map<string, Intl.PluralRules>()
function plural(intl: string, n: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(intl)
  if (!rules) {
    rules = new Intl.PluralRules(intl)
    pluralRules.set(intl, rules)
  }
  return rules.select(n)
}

function fmtDate(day: string, intl: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
  return dateFormat(intl, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  )
}

function fmtMonth(month: string, intl: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  return dateFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))
}

const isMailKey = (key: string, strings: MailStrings): key is MailKey => Object.hasOwn(strings, key)

interface Spec {
  subject: string
  paragraphs: string[]
  cta?: { path: string; label: string }
}

function build(kind: MailKind, L: MailStrings, locale: string, v: JsonObject, ctx: RenderContext): Spec {
  const intl = intlLocale(locale)
  const say = (key: MailKey, extra: Record<string, string | number> = {}) => fill(L[key], { ...vars, ...extra })
  const days = Number(v.days ?? 0)
  const daysText = fill(L[plural(intl, days) === "one" ? "common.days_one" : "common.days_other"], {
    count: Number.isInteger(days) ? days : days.toLocaleString(intl),
  })
  const typeKey = `type.${str(v.typeKey)}`
  const vars: Record<string, string | number> = {
    company: ctx.company,
    actor: str(v.actorName) || L["common.someone"],
    requester: str(v.requesterName),
    type: str(v.typeKey) && isMailKey(typeKey, L) ? L[typeKey] : str(v.typeLabel || v.typeKey),
    start: fmtDate(str(v.start), intl),
    end: fmtDate(str(v.end), intl),
    date: fmtDate(str(v.date), intl),
    days: daysText,
    note: str(v.note),
    reason: str(v.reason),
    email: str(v.email),
    newEmail: str(v.newEmail),
    message: str(v.message),
    minutes: str(v.minutes),
    hours: str(v.hours),
    month: fmtMonth(str(v.month), intl),
    url: `${ctx.baseUrl}/forgot`,
  }
  const note = v.note ? [say("common.note")] : []
  const reason = v.reason ? [say("common.reason")] : []
  const body = (key: MailKey) => say(key).split("\n\n")
  const absences = { path: "/absences", label: "" }
  switch (kind) {
    case "invite":
      return {
        subject: say("invite.subject"),
        paragraphs: body("invite.body"),
        cta: { path: str(v.url), label: say("invite.cta") },
      }
    case "password_reset":
      return {
        subject: say("password_reset.subject"),
        paragraphs: body("password_reset.body"),
        cta: { path: str(v.url), label: say("password_reset.cta") },
      }
    case "password_changed":
      return { subject: say("password_changed.subject"), paragraphs: body("password_changed.body") }
    case "passkey_added":
      return { subject: say("passkey_added.subject"), paragraphs: body("passkey_added.body") }
    case "password_set_by_admin":
      return {
        subject: say("password_set_by_admin.subject"),
        paragraphs: body("password_set_by_admin.body"),
        cta: { path: "/login", label: say("password_set_by_admin.cta") },
      }
    case "email_changed":
      return { subject: say("email_changed.subject"), paragraphs: [...body("email_changed.body"), L["common.ignore"]] }
    case "entry_corrected": {
      const action = isOneOf(["create", "update", "delete"], v.action) ? v.action : "update"
      const time = v.end ? `${str(v.start)}–${str(v.end)}` : str(v.start)
      return {
        subject: say("entry_corrected.subject"),
        paragraphs: [say(`entry_corrected.${action}`, { time }), ...reason, say("entry_corrected.footer")],
        cta: { path: v.date ? `/time?date=${str(v.date)}` : "/time", label: say("entry_corrected.cta") },
      }
    }
    case "entry_disputed":
      return {
        subject: say("entry_disputed.subject"),
        paragraphs: body("entry_disputed.body"),
        cta: { path: str(v.path) || "/team", label: say("entry_disputed.cta") },
      }
    case "absence_requested":
      return {
        subject: say("absence_requested.subject"),
        paragraphs: [say("absence_requested.body"), ...note],
        cta: { path: "/team/approvals", label: say("absence_requested.cta") },
      }
    case "absence_reported":
      return {
        subject: say("absence_reported.subject"),
        paragraphs: [say("absence_reported.body")],
        cta: { path: "/team", label: say("absence_reported.cta") },
      }
    case "absence_recorded":
      return {
        subject: say("absence_recorded.subject"),
        paragraphs: [
          say("absence_recorded.body"),
          ...(v.allowsAttachments ? [say("absence_recorded.attachments")] : []),
        ],
        cta: { ...absences, label: say("absence_recorded.cta") },
      }
    case "absence_approved":
      return {
        subject: say("absence_approved.subject"),
        paragraphs: [say("absence_approved.body"), ...note],
        cta: { ...absences, label: say("absence_approved.cta") },
      }
    case "absence_rejected":
      return {
        subject: say("absence_rejected.subject"),
        paragraphs: [say("absence_rejected.body"), ...note],
        cta: { ...absences, label: say("absence_rejected.cta") },
      }
    case "absence_cancelled":
      return {
        subject: say("absence_cancelled.subject"),
        paragraphs: [say("absence_cancelled.body"), ...reason],
        cta: { ...absences, label: say("absence_cancelled.cta") },
      }
    case "absence_changed":
      return {
        subject: say("absence_changed.subject"),
        paragraphs: [say("absence_changed.body"), ...reason],
        cta: { ...absences, label: say("absence_changed.cta") },
      }
    case "clock_reminder": {
      const tz = str(v.tz) || "Europe/Zurich"
      const since = v.since ? new Date(str(v.since)) : new Date()
      const time = dateFormat(intl, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(since)
      const date = dateFormat(intl, { day: "numeric", month: "long", timeZone: tz }).format(since)
      return {
        subject: say("clock_reminder.subject"),
        paragraphs: [say("clock_reminder.body", { time, date })],
        cta: { path: "/", label: say("clock_reminder.cta") },
      }
    }
    case "test":
      return { subject: say("test.subject"), paragraphs: [say("test.body")] }
    case "month_signed_off":
      return {
        subject: say("month_signed_off.subject"),
        paragraphs: [say("month_signed_off.body")],
        cta: { path: v.month ? `/reports?month=${str(v.month)}` : "/reports", label: say("month_signed_off.cta") },
      }
    case "mfa_reset":
      return {
        subject: say("mfa_reset.subject"),
        paragraphs: [say("mfa_reset.body"), L["common.ignore"]],
        cta: { path: "/profile#mfa", label: say("mfa_reset.cta") },
      }
  }
  throw new Error(`unknown mail kind ${String(kind)}`)
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function absoluteUrl(pathOrUrl: string, baseUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl
  return `${baseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`
}

/**
 * Services send notification-style snake_case variables (`actor_name`, `start_date`, `local_start`); the
 * templates read camelCase (`actorName`, `start`, `date`). One mapping here keeps both sides simple.
 */
export function normalizeVars(raw: JsonObject): JsonObject {
  const v: JsonObject = {}
  for (const [k, val] of Object.entries(raw)) v[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = val
  v.start ??= v.startDate ?? null
  v.end ??= v.endDate ?? null
  if (typeof v.localStart === "string") {
    const [d, t] = v.localStart.split(" ")
    v.date ??= d
    v.start = t ?? v.localStart
  }
  if (typeof v.localEnd === "string") v.end = v.localEnd.split(" ")[1] ?? v.localEnd
  v.typeLabel ??= v.type ?? null
  return v
}

export function renderMail(
  kind: MailKind,
  locale: string,
  recipientName: string,
  vars: JsonObject,
  ctx: RenderContext,
): RenderedMail {
  const loc = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE
  const L = MAIL_STRINGS[loc]
  const spec = build(kind, L, loc, normalizeVars(vars), ctx)
  const hello = fill(L["common.hello"], { name: recipientName })
  const ctaUrl = spec.cta ? absoluteUrl(spec.cta.path, ctx.baseUrl) : null
  const text = [
    hello,
    ...spec.paragraphs,
    ...(ctaUrl ? [`${spec.cta?.label}: ${ctaUrl}`] : []),
    `RESORIXtrack · ${ctx.company}`,
  ].join("\n\n")
  const p = (s: string) => `<p style="margin:0 0 14px">${esc(s).replace(/\n/g, "<br>")}</p>`
  const header = ctx.hasLogo
    ? `<img src="cid:logo" alt="${esc(ctx.company)}" width="180" style="display:block;border:0;height:auto">`
    : `<span style="font-size:18px;font-weight:700;color:#14254d">${esc(ctx.company)}</span>`
  const cta = ctaUrl
    ? `<tr><td style="padding:8px 32px 24px"><a href="${esc(ctaUrl)}" style="display:inline-block;background:${ctx.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(spec.cta?.label ?? "")}</a><p style="margin:16px 0 0;font-size:12px;color:#62656b;word-break:break-all">${esc(ctaUrl)}</p></td></tr>`
    : ""
  const html = `<!doctype html>
<html lang="${loc}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(spec.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef2f6;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1f">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f6;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="height:6px;background:${ctx.accent}"></td></tr>
<tr><td style="padding:28px 32px 8px">${header}</td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#14254d">${esc(spec.subject)}</h1></td></tr>
<tr><td style="padding:0 32px;font-size:15px;line-height:1.6;color:#2a2b2e">${p(hello)}${spec.paragraphs.map(p).join("")}</td></tr>
${cta}
<tr><td style="padding:16px 32px 28px;border-top:1px solid #eef2f6;font-size:12px;color:#8a8d93">RESORIXtrack · ${esc(ctx.company)}</td></tr>
</table></td></tr></table></body></html>`
  return { subject: spec.subject, text, html }
}

/** Logo for emails: an uploaded PNG (email clients do not render SVG), else the bundled default; none for SVG-only branding. */
export function emailLogo(): Buffer | null {
  const custom = ["light", "dark"]
    .flatMap((v) => [".png", ".svg", ".webp"].map((ext) => path.join(env.brandingDir, `logo-${v}${ext}`)))
    .filter((f) => existsSync(f))
  if (custom.length) {
    const png = custom.find((f) => f.endsWith(".png"))
    return png ? readFileSync(png) : null
  }
  return Buffer.from(DEFAULT_EMAIL_LOGO_PNG, "base64")
}
