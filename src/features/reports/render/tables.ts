/**
 * Report data → typed sheets, shared by the XLSX and CSV writers. Each column has a kind so writers can
 * produce real dates, times and durations instead of text.
 */
import type { ComplianceReportData } from "@/features/reports/compliance-report"
import type { Finding } from "@/server/services/compliance"
import type {
  AbsencesReportData,
  BalancesData,
  ProjectHoursData,
  RawEntryRow,
  TimesheetData,
} from "@/server/services/reports"
import { type ExportI18n, hm, wallTime } from "./labels"

export type ColKind = "text" | "date" | "time" | "datetime" | "duration" | "days" | "number" | "bool"
export interface Column {
  header: string
  kind: ColKind
}
export type Plain = string | number | boolean | null
/** A cell; `{ value, kind }` overrides the column kind (e.g. days in a duration column). */
export type CellValue = Plain | { value: Plain; kind: ColKind }
export interface Sheet {
  title: string
  columns: Column[]
  rows: CellValue[][]
  /** row indices rendered bold (totals) */
  bold?: number[]
}

const col = (header: string, kind: ColKind = "text"): Column => ({ header, kind })

export const DAY_RULES = new Set(["consecutive_days", "vacation_minimum", "vacation_block"])

export function findingWhen(f: Pick<Finding, "date" | "week" | "year">): string {
  return f.date ?? f.week ?? (f.year != null ? String(f.year) : "")
}

export function findingAmount(f: Pick<Finding, "rule">, v: number): string {
  return DAY_RULES.has(f.rule) ? String(Math.round(v * 10) / 10) : hm(v)
}

function projectTimeText(items: TimesheetData["projectTime"][string] | undefined): string {
  return (items ?? [])
    .map((w) => {
      const when = w.start ? `${w.start}-${w.end ?? ""} ` : ""
      const ref = w.project
      const what = ref && w.note ? `${ref}: ${w.note}` : ref || w.note
      return `${when}${what} (${hm(w.minutes)})`.trim()
    })
    .join("; ")
}

const pad = (n: number) => Array.from({ length: n }, () => null)

/** Payroll columns: Sunday, holiday and night work, the supplement (payroll mode) and time credits. */
function payrollColumns(x: ExportI18n, payroll: TimesheetData["payroll"], withCredit: boolean): Column[] {
  const { L } = x
  return [
    col(L("sunday_work"), "duration"),
    col(L("holiday_work"), "duration"),
    col(L("night_work"), "duration"),
    ...(payroll.mode === "payroll" ? [col(L("supplement_percent"), "number")] : []),
    ...(withCredit ? [col(L("time_credit"), "duration")] : []),
  ]
}

function payrollCells(
  v: { sunday: number; holiday: number; night: number; credit: number },
  payroll: TimesheetData["payroll"],
  withCredit: boolean,
): CellValue[] {
  return [
    v.sunday || null,
    v.holiday || null,
    v.night || null,
    ...(payroll.mode === "payroll" ? [v.sunday + v.holiday > 0 ? payroll.percent : null] : []),
    ...(withCredit ? [v.credit || null] : []),
  ]
}

export function timesheetSheet(d: TimesheetData, x: ExportI18n): Sheet {
  const { L } = x
  const s = d.summary
  const withCredit = s.surchargeMin + s.nightCreditMin > 0
  const pay = payrollColumns(x, d.payroll, withCredit)
  const columns = [
    col(L("date"), "date"),
    col(L("weekday")),
    col(L("holiday")),
    col(L("absence")),
    col(L("first_start"), "time"),
    col(L("last_end"), "time"),
    col(L("break"), "duration"),
    col(L("worked"), "duration"),
    col(L("target"), "duration"),
    col(L("delta"), "duration"),
    ...pay,
    col(L("edited"), "bool"),
    col(L("project_time")),
  ]
  const rows: CellValue[][] = d.days.map((day) => [
    day.date,
    x.weekday(day.date),
    day.holiday ? x.holidayName(day.holiday.name) : "",
    day.absences
      .map(
        (a) =>
          `${x.absenceLabel({ key: a.typeKey, label: a.label })}${a.halves.length === 1 ? " ½" : ""}${a.status === "pending" ? ` (${x.status("pending")})` : ""}`,
      )
      .join(", "),
    wallTime(day.firstStart, d.user.timezone) || null,
    wallTime(day.lastEnd, d.user.timezone) || null,
    day.breakMin || null,
    day.workedMin || null,
    day.targetMin || null,
    day.isToday && (day.workedMin || day.targetMin)
      ? { value: x.L("in_progress"), kind: "text" }
      : day.isFuture
        ? null
        : day.deltaMin,
    ...payrollCells(
      {
        sunday: day.sundayWorkMin,
        holiday: day.holidayWorkMin,
        night: day.nightWorkMin,
        credit: day.surchargeMin + day.nightCreditMin,
      },
      d.payroll,
      withCredit,
    ),
    day.edited,
    projectTimeText(d.projectTime[day.date]),
  ])
  const total = rows.length
  const tail = pad(2)
  rows.push([
    L("total"),
    ...pad(6),
    s.workedCompleteMin,
    s.targetMin,
    s.deltaMin,
    ...payrollCells(
      {
        sunday: s.sundayWorkMin,
        holiday: s.holidayWorkMin,
        night: s.nightWorkMin,
        credit: s.surchargeMin + s.nightCreditMin,
      },
      d.payroll,
      withCredit,
    ),
    ...tail,
  ])
  const after = pad(pay.length + 2)
  rows.push([L("balance_before"), ...pad(8), d.balanceBeforeMin, ...after])
  rows.push([L("balance_after"), ...pad(8), d.balanceAfterMin, ...after])
  rows.push([L("vacation_left"), ...pad(8), { value: d.vacation.remaining, kind: "days" }, ...after])
  return { title: `${d.year}-${String(d.month).padStart(2, "0")}`, columns, rows, bold: [total] }
}

export function balancesSheet(d: BalancesData, x: ExportI18n): Sheet {
  const { L } = x
  const withCredit = d.totals.creditMin > 0
  const columns = [
    col(L("name")),
    col(L("team")),
    col(L("target"), "duration"),
    col(L("worked"), "duration"),
    col(L("delta"), "duration"),
    col(L("balance"), "duration"),
    ...payrollColumns(x, d.payroll, withCredit),
    col(L("taken"), "days"),
    col(L("planned"), "days"),
    col(L("pending"), "days"),
    col(L("vacation_left"), "days"),
  ]
  const pay = (r: BalancesData["totals"]) =>
    payrollCells(
      { sunday: r.sundayMin, holiday: r.holidayMin, night: r.nightMin, credit: r.creditMin },
      d.payroll,
      withCredit,
    )
  const rows: CellValue[][] = d.rows.map((r) => [
    r.name,
    r.team ?? "",
    r.targetMin,
    r.workedMin,
    r.deltaMin,
    r.balanceMin,
    ...pay(r),
    r.vacationTaken,
    r.vacationPlanned,
    r.vacationPending,
    r.vacationRemaining,
  ])
  const t = d.totals
  rows.push([L("total"), "", t.targetMin, t.workedMin, t.deltaMin, t.balanceMin, ...pay(t), null, null, null, null])
  return { title: L("balances"), columns, rows, bold: [rows.length - 1] }
}

export function absencesSheets(d: AbsencesReportData, x: ExportI18n): Sheet[] {
  const { L } = x
  const label = (key: string, fallback: string) => x.absenceLabel({ key, label: fallback })
  const details: Sheet = {
    title: L("details"),
    columns: [
      col(L("name")),
      col(L("type")),
      col(L("status")),
      col(L("from"), "date"),
      col(L("to"), "date"),
      col(L("start_half")),
      col(L("end_half")),
      col(L("days"), "days"),
      col(L("note")),
    ],
    rows: d.rows.map((r) => [
      r.name,
      label(r.typeKey, r.type),
      x.status(r.status),
      r.startDate,
      r.endDate,
      L(`half_${r.startHalf}`),
      L(`half_${r.endHalf}`),
      r.days,
      r.note,
    ]),
  }
  const summary: Sheet = {
    title: L("summary"),
    columns: [col(L("name")), ...d.types.map((t) => col(label(t.key, t.label), "days")), col(L("total"), "days")],
    rows: d.summary.map((s) => [s.name, ...d.types.map((t) => s.byType[t.key] ?? null), s.total]),
  }
  return [summary, details]
}

export function projectName(p: ProjectHoursData["projects"][number], x: ExportI18n): string {
  return p.name ?? x.L("no_project")
}

export function projectsSheet(d: ProjectHoursData, x: ExportI18n): Sheet {
  const { L } = x
  const rows: CellValue[][] = []
  const bold: number[] = []
  for (const p of d.projects) {
    bold.push(rows.length)
    rows.push([projectName(p, x), p.code, p.team ?? "", L("total"), p.minutes, p.items])
    for (const person of p.people)
      rows.push([projectName(p, x), p.code, p.team ?? "", person.name, person.minutes, null])
  }
  return {
    title: L("projects"),
    columns: [
      col(L("project")),
      col(L("code")),
      col(L("team")),
      col(L("person")),
      col(L("worked"), "duration"),
      col(L("items"), "number"),
    ],
    rows,
    bold,
  }
}

export function entriesSheet(rows: RawEntryRow[], x: ExportI18n): Sheet {
  const { L } = x
  return {
    title: L("entries"),
    columns: [
      col(L("entry_id"), "number"),
      col(L("name")),
      col(L("email")),
      col(L("kind")),
      col(L("date"), "date"),
      col(L("start_local"), "datetime"),
      col(L("end_local"), "datetime"),
      col(L("start_utc")),
      col(L("end_utc")),
      col(L("minutes"), "duration"),
      col(L("timezone")),
      col(L("source")),
      col(L("edited"), "bool"),
      col(L("deleted"), "bool"),
      col(L("note")),
    ],
    rows: rows.map((r) => [
      r.entryId,
      r.name,
      r.email,
      L(`kind_${r.kind}`),
      r.date,
      r.startLocal,
      r.endLocal || null,
      r.startUtc,
      r.endUtc,
      r.minutes,
      r.timezone,
      L(`source_${r.source}`),
      r.edited,
      r.deleted,
      r.note,
    ]),
  }
}

const amount = (f: Finding, v: number): CellValue => (DAY_RULES.has(f.rule) ? { value: v, kind: "days" } : v)

export function complianceSheets(d: ComplianceReportData, x: ExportI18n): Sheet[] {
  const { L, t } = x
  const summary: Sheet = {
    title: L("summary"),
    columns: [
      col(L("name")),
      col(L("team")),
      col(t("compliance.severity.violation"), "number"),
      col(t("compliance.severity.warning"), "number"),
      col(t("compliance.severity.info"), "number"),
      col(L("ueberzeit", { year: d.year }), "duration"),
      col(L("limit"), "duration"),
    ],
    rows: d.rows.map((r) => [
      r.name,
      r.team ?? "",
      r.counts.violation,
      r.counts.warning,
      r.counts.info,
      r.overtime.overtimeMin,
      r.overtime.limitMin,
    ]),
  }
  const details: Sheet = {
    title: L("details"),
    columns: [
      col(L("name")),
      col(L("when")),
      col(L("rule")),
      col(L("severity")),
      col(L("value"), "duration"),
      col(L("limit"), "duration"),
      col(L("ref")),
    ],
    rows: d.rows.flatMap((r) =>
      r.findings.map((f) => [
        r.name,
        findingWhen(f),
        t(`compliance.rule.${f.rule}`),
        t(`compliance.severity.${f.severity}`),
        amount(f, f.value),
        amount(f, f.limit),
        f.ref,
      ]),
    ),
  }
  return [summary, details]
}
