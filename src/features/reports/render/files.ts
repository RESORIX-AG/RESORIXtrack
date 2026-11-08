import type ExcelJS from "exceljs"
import type { Locale } from "@/lib/i18n-core"
import type { CellValue, ColKind, Plain, Sheet } from "./tables"

const DAY_MIN = 1440

function unwrap(c: CellValue, kind: ColKind): { value: Plain; kind: ColKind } {
  return c != null && typeof c === "object" ? c : { value: c, kind }
}

const clockToFraction = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return (h * 60 + m) / DAY_MIN
}

/** Spreadsheet formula injection: text that starts like a formula stays text when the CSV is opened. */
function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

// ------------------------------------------------------------------ XLSX

const XLSX_FORMATS: Record<ColKind, (locale: Locale) => string | undefined> = {
  text: () => undefined,
  bool: () => undefined,
  number: () => "0",
  days: () => "0.0#",
  // 1904 date system: Excel then shows negative durations instead of #####
  duration: () => "[h]:mm;-[h]:mm",
  time: () => "hh:mm",
  date: (l) => (l === "en" ? "yyyy-mm-dd" : "dd.mm.yyyy"),
  datetime: (l) => (l === "en" ? "yyyy-mm-dd hh:mm" : "dd.mm.yyyy hh:mm"),
}

function xlsxValue(v: Plain, kind: ColKind, yes: string): ExcelJS.CellValue {
  if (v == null || v === "") return null
  if (typeof v === "boolean") return v ? yes : null
  if (typeof v === "number") return kind === "duration" ? v / DAY_MIN : v
  if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`)
  if (kind === "datetime" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return new Date(`${v.replace(" ", "T")}:00Z`)
  if (kind === "time" && /^\d{2}:\d{2}$/.test(v)) return clockToFraction(v)
  return v
}

export async function toXlsx(sheets: Sheet[], opts: { locale: Locale; yes: string; accent: string; title: string }) {
  // loaded on first use: exceljs is large and only needed when someone downloads a spreadsheet
  const { default: Excel } = await import("exceljs")
  const wb = new Excel.Workbook()
  wb.creator = "RESORIXtrack"
  wb.title = opts.title
  wb.created = new Date()
  wb.properties.date1904 = true
  const fill = opts.accent.replace("#", "").toUpperCase()
  const used = new Set<string>()
  for (const sheet of sheets) {
    let name = sheet.title.replace(/[*?:\\/[\]]/g, "-").slice(0, 31) || "Sheet"
    while (used.has(name)) name = `${name.slice(0, 28)} ${used.size}`
    used.add(name)
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] })
    ws.columns = sheet.columns.map((c, i) => {
      const longest = Math.max(
        c.header.length,
        ...sheet.rows.slice(0, 500).map((r) => {
          const { value } = unwrap(r[i] ?? null, c.kind)
          return value == null ? 0 : c.kind === "duration" || c.kind === "time" ? 7 : String(value).length
        }),
      )
      return { header: c.header, key: String(i), width: Math.min(Math.max(10, longest + 2), 60) }
    })
    const head = ws.getRow(1)
    head.font = { bold: true, color: { argb: "FFFFFFFF" } }
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } }
    head.alignment = { vertical: "middle" }
    sheet.rows.forEach((r, ri) => {
      const row = ws.addRow([])
      sheet.columns.forEach((c, ci) => {
        const { value, kind } = unwrap(r[ci] ?? null, c.kind)
        const cell = row.getCell(ci + 1)
        cell.value = xlsxValue(value, kind, opts.yes)
        const fmt =
          typeof value === "string" && kind !== "date" && kind !== "datetime" && kind !== "time"
            ? undefined
            : XLSX_FORMATS[kind](opts.locale)
        if (fmt && cell.value != null) cell.numFmt = fmt
        if (["duration", "days", "number", "time"].includes(kind)) cell.alignment = { horizontal: "right" }
      })
      if (sheet.bold?.includes(ri)) row.font = { bold: true }
    })
    if (sheet.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

// ------------------------------------------------------------------ CSV

function decimalSeparator(intl: string): string {
  return new Intl.NumberFormat(intl).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? "."
}

/** UTF-8 with BOM (Excel detects it); semicolon for de/fr, comma for en; durations as decimal hours. */
export function toCsv(
  sheet: Sheet,
  opts: { locale: Locale; intl: string; yes: string; hoursSuffix: string; daysUnit: string },
): Uint8Array {
  const sep = opts.locale === "en" ? "," : ";"
  const dec = decimalSeparator(opts.intl)
  const num = (n: number, digits: number) => {
    const r = Math.round(n * 10 ** digits) / 10 ** digits
    return String(r).replace(".", dec)
  }
  const quote = (s: string) => (/[",;\r\n]/.test(s) || s.includes(sep) ? `"${s.replaceAll('"', '""')}"` : s)
  const cell = (c: CellValue, colKind: ColKind): string => {
    const { value, kind } = unwrap(c, colKind)
    if (value == null) return ""
    if (typeof value === "boolean") return value ? opts.yes : ""
    // a cell whose kind differs from its column (days in an hours column) carries its unit as text
    if (typeof value === "number" && kind !== colKind)
      return quote(kind === "days" ? `${num(value, 2)} ${opts.daysUnit}` : num(value, 2))
    if (typeof value === "number") return kind === "duration" ? num(value / 60, 2) : num(value, 2)
    return quote(safeText(value))
  }
  // headers carry admin-defined names (absence types, projects): guarded against formulas like the cells
  const header = sheet.columns.map((c) =>
    quote(safeText(c.kind === "duration" ? `${c.header} ${opts.hoursSuffix}` : c.header)),
  )
  const lines = [
    header.join(sep),
    ...sheet.rows.map((r) => sheet.columns.map((c, i) => cell(r[i] ?? null, c.kind)).join(sep)),
  ]
  return new TextEncoder().encode(`﻿${lines.join("\r\n")}\r\n`)
}
