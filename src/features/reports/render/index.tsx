/**
 * Report downloads: builds the report through the permission-checked services and renders it as PDF, XLSX
 * or CSV in the requester's locale. Server only (used by src/routes/api/reports/$kind.ts).
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { DocumentProps } from "@react-pdf/renderer"
import type { ReactElement } from "react"
import { z } from "zod"
import { complianceReport, complianceReportInput } from "@/features/reports/compliance-report"
import { isLocale, type Locale } from "@/lib/i18n-core"
import { env } from "@/server/env"
import { Validation } from "@/server/errors"
import type { Actor } from "@/server/services/permissions"
import {
  absencesReport,
  balances,
  balancesInput,
  projectHours,
  rangeInput,
  rawEntries,
  timesheet,
  timesheetInput,
} from "@/server/services/reports"
import { getAllSettings } from "@/server/services/settings"
import { toCsv, toXlsx } from "./files"
import { exportI18n, slug } from "./labels"
import type { PdfContext } from "./pdf"
import {
  absencesSheets,
  balancesSheet,
  complianceSheets,
  entriesSheet,
  projectsSheet,
  type Sheet,
  timesheetSheet,
} from "./tables"

type PdfModule = typeof import("./pdf")

export const REPORT_KINDS = ["timesheet", "balances", "absences", "projects", "entries", "compliance"] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export const FORMATS = ["pdf", "xlsx", "csv"] as const
export type ReportFormat = (typeof FORMATS)[number]

const CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
}

const int = z.coerce.number().int()
const optId = z.preprocess((v) => (v === "" || v == null ? undefined : v), int.positive().optional())
const queries = {
  timesheet: z.object({ userId: optId, year: int, month: int }),
  balances: z.object({
    year: int,
    month: z.preprocess((v) => (v === "" || v == null ? undefined : v), int.optional()),
    teamId: optId,
  }),
  range: z.object({ from: z.string(), to: z.string(), teamId: optId, userId: optId }),
}

function parse<T extends z.ZodType>(schema: T, params: URLSearchParams): z.output<T> {
  const r = schema.safeParse(Object.fromEntries(params))
  if (!r.success) throw new Validation("Invalid report parameters", { fields: { query: "invalid" } })
  return r.data
}

function logoPng(): Buffer | null {
  const file = path.join(env.brandingDir, "logo-light.png")
  return existsSync(file) ? readFileSync(file) : null
}

export interface RenderedReport {
  body: Uint8Array
  contentType: string
  filename: string
}

/** Build and render one report. Throws AppErrors (permission, validation) from the services. */
export async function renderReport(
  actor: Actor,
  kind: ReportKind,
  format: ReportFormat,
  params: URLSearchParams,
): Promise<RenderedReport> {
  const locale: Locale = isLocale(actor.user.locale) ? actor.user.locale : "en"
  const x = exportI18n(locale)
  const settings = getAllSettings()
  const accent = /^#[0-9a-fA-F]{6}$/.test(settings.brand_accent) ? settings.brand_accent : "#35a1cc"
  const generated = Temporal.Now.zonedDateTimeISO(actor.user.timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" })
    .replace("T", " ")
  const ctx = (company: string): PdfContext => ({ x, company, accent, logo: logoPng(), generated })

  let name: string
  let sheets: Sheet[]
  let pdf: ((p: PdfModule) => ReactElement<DocumentProps>) | null = null
  switch (kind) {
    case "timesheet": {
      const q = parse(queries.timesheet, params)
      const d = timesheet(actor, timesheetInput.parse(q))
      name = `${x.L("timesheet")}-${slug(d.user.name)}-${d.year}-${String(d.month).padStart(2, "0")}`
      sheets = [timesheetSheet(d, x)]
      pdf = (p) => <p.TimesheetPdf d={d} ctx={ctx(d.company)} />
      break
    }
    case "balances": {
      const q = parse(queries.balances, params)
      const d = balances(actor, balancesInput.parse(q))
      name = `${x.L("balances")}-${d.year}${d.month ? `-${String(d.month).padStart(2, "0")}` : ""}`
      sheets = [balancesSheet(d, x)]
      pdf = (p) => <p.BalancesPdf d={d} ctx={ctx(d.company)} />
      break
    }
    case "absences": {
      const d = absencesReport(actor, rangeInput.parse(parse(queries.range, params)))
      name = `${x.L("absences")}-${d.start}-${d.end}`
      sheets = absencesSheets(d, x)
      pdf = (p) => <p.AbsencesPdf d={d} ctx={ctx(d.company)} />
      break
    }
    case "projects": {
      const d = projectHours(actor, rangeInput.parse(parse(queries.range, params)))
      name = `${x.L("projects")}-${d.start}-${d.end}`
      sheets = [projectsSheet(d, x)]
      pdf = (p) => <p.ProjectsPdf d={d} ctx={ctx(d.company)} />
      break
    }
    case "entries": {
      const input = rangeInput.parse(parse(queries.range, params))
      const rows = rawEntries(actor, input)
      name = `${x.L("entries")}-${input.from}-${input.to}`
      sheets = [entriesSheet(rows, x)]
      break
    }
    case "compliance": {
      const d = complianceReport(actor, complianceReportInput.parse(parse(queries.range, params)))
      name = `${x.L("compliance")}-${d.start}-${d.end}`
      sheets = complianceSheets(d, x)
      pdf = (p) => <p.CompliancePdf d={d} ctx={ctx(d.company)} />
      break
    }
  }
  const filename = `${slug(name)}.${format}`
  if (format === "pdf") {
    if (!pdf) throw new Validation("This report is available as XLSX or CSV", { fields: { format: "invalid" } })
    // the PDF stack is loaded on the first PDF download, not at server start
    const [{ renderToBuffer }, components] = await Promise.all([import("@react-pdf/renderer"), import("./pdf")])
    const body = new Uint8Array(await renderToBuffer(pdf(components)))
    return { body, contentType: CONTENT_TYPES.pdf, filename }
  }
  if (format === "xlsx") {
    const body = await toXlsx(sheets, { locale, yes: x.L("yes"), accent, title: name })
    return { body, contentType: CONTENT_TYPES.xlsx, filename }
  }
  // CSV holds one table: the detail sheet where a report has several
  const sheet = sheets[sheets.length - 1]
  return {
    body: toCsv(sheet, {
      locale,
      intl: x.intl,
      yes: x.L("yes"),
      hoursSuffix: x.L("hours_suffix"),
      daysUnit: x.L("days_unit"),
    }),
    contentType: CONTENT_TYPES.csv,
    filename,
  }
}
