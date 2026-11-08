/**
 * Member page panels: absences, work schedule (read), labour-law findings and the change history.
 */
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { useState, useTransition } from "react"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { AbsenceStatusBadge, ColorDot } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { StatCard, StatGrid } from "@/components/data/stat"
import { tableHelper } from "@/components/data/table-helper"
import { AbsenceSheet } from "@/features/absences/absence-sheet"
import { absencesQuery } from "@/features/absences/api"
import { formatSpan } from "@/features/absences/lib"
import { useAuditFormat } from "@/features/admin/logs/change-list"
import { findingsQuery, yearFindingsQuery } from "@/features/compliance/api"
import { OvertimeMeter } from "@/features/reports/compliance-preview"
import { MonthNav } from "@/features/reports/controls"
import { type FindingRow, FindingsTable } from "@/features/reports/findings"
import { ScheduleEditor } from "@/features/schedules/schedule-editor"
import { userHistoryQuery } from "@/features/time/api"
import { todayIn } from "@/features/time/lib"
import { fmtDateTime, fmtDays, fmtMinutes, monthRange } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { AbsenceDto } from "@/server/services/absences"
import type { userHistory } from "@/server/services/entries"
import { memberSchedulesQuery } from "./api"

// ------------------------------------------------------------------ absences

const absCol = tableHelper<AbsenceDto>()

export function AbsencesPanel({ userId, onEdit }: { userId: number; onEdit: (a: AbsenceDto) => void }) {
  const i = useI18n()
  const { t } = i
  const me = useMe()
  const today = todayIn(me.timezone)
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [pending, startTransition] = useTransition()
  const { data } = useSuspenseQuery(absencesQuery({ userId, from: `${year}-01-01`, to: `${year}-12-31` }))
  const [open, setOpen] = useState<AbsenceDto | null>(null)
  const columns = [
    absCol.accessor((a) => a.type.label, {
      id: "type",
      header: () => t("common.type"),
      meta: { primary: true },
      cell: (c) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <ColorDot color={c.row.original.type.color} />
          {i.absenceLabel(c.row.original.type)}
        </span>
      ),
    }),
    absCol.accessor("startDate", {
      header: () => t("reports.period"),
      meta: { mobileLabel: t("reports.period"), className: "whitespace-nowrap" },
      cell: (c) => formatSpan(c.row.original, i),
    }),
    absCol.accessor("days", {
      header: () => t("common.days"),
      meta: { numeric: true, mobileLabel: t("common.days") },
      cell: (c) => fmtDays(c.getValue()),
    }),
    absCol.accessor("status", {
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) => <AbsenceStatusBadge status={c.getValue()} label={t(`absences.status.${c.getValue()}`)} />,
    }),
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <PeriodNav
          label={String(year)}
          onPrev={() => setYear(year - 1)}
          onNext={() => setYear(year + 1)}
          onToday={() => setYear(Number(today.slice(0, 4)))}
          isCurrent={year === Number(today.slice(0, 4))}
          startTransition={startTransition}
        />
      </div>
      <PeriodContent className={pending ? "opacity-60 transition-opacity" : undefined}>
        <DataTable
          data={data}
          columns={columns}
          getRowId={(a) => String(a.id)}
          initialSorting={[{ id: "startDate", desc: true }]}
          onRowClick={(a) => setOpen(a)}
          empty={t("member.no_absences")}
          rowClassName={(a) => (a.status === "cancelled" || a.status === "rejected" ? "opacity-60" : undefined)}
        />
      </PeriodContent>
      <AbsenceSheet
        absence={open}
        open={open != null}
        onOpenChange={(o) => !o && setOpen(null)}
        onEdit={(a) => {
          setOpen(null)
          onEdit(a)
        }}
      />
    </div>
  )
}

// ------------------------------------------------------------------ schedule

export function SchedulePanel({ userId }: { userId: number }) {
  const { data } = useSuspenseQuery(memberSchedulesQuery(userId))
  return <ScheduleEditor userId={userId} data={data} />
}

// ------------------------------------------------------------------ compliance

export function CompliancePanel({ userId }: { userId: number }) {
  const { t } = useI18n()
  const me = useMe()
  const today = todayIn(me.timezone)
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [pending, startTransition] = useTransition()
  const year = Number(month.slice(0, 4))
  const [{ data: period }, { data: yearly }] = useSuspenseQueries({
    queries: [findingsQuery({ userId, ...monthRange(month) }), yearFindingsQuery({ userId, year })],
  })
  const rows: FindingRow[] = [...period.findings, ...yearly.findings]
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <MonthNav month={month} today={today} onChange={setMonth} startTransition={startTransition} />
      </div>
      <PeriodContent className={pending ? "flex flex-col gap-6 opacity-60 transition-opacity" : "flex flex-col gap-6"}>
        <StatGrid>
          <StatCard
            label={t("compliance.severity.violation")}
            value={period.counts.violation}
            tone={period.counts.violation ? "negative" : "default"}
          />
          <StatCard label={t("compliance.severity.warning")} value={period.counts.warning} />
          <StatCard label={t("compliance.severity.info")} value={period.counts.info} />
          <StatCard label={t("compliance.ueberzeit_year", { year })} value={fmtMinutes(yearly.overtime.overtimeMin)}>
            <OvertimeMeter o={{ ...yearly.overtime, year }} />
          </StatCard>
        </StatGrid>
        <FindingsTable rows={rows} />
      </PeriodContent>
    </div>
  )
}

// ------------------------------------------------------------------ history

type Rev = ReturnType<typeof userHistory>[number]
const histCol = tableHelper<Rev>()

export function HistoryPanel({ userId }: { userId: number }) {
  const { t, intl, has } = useI18n()
  const me = useMe()
  const { data } = useSuspenseQuery(userHistoryQuery(userId))
  const columns = [
    histCol.accessor("at", {
      header: () => t("member.when"),
      meta: { primary: true, className: "whitespace-nowrap" },
      cell: (c) => fmtDateTime(c.getValue(), { intl, tz: me.timezone, hour12: me.timeFormat === "12h" }),
    }),
    histCol.accessor((r) => r.actor?.name ?? "", {
      id: "who",
      header: () => t("member.who"),
      meta: { mobileLabel: t("member.who") },
      cell: (c) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{c.getValue() || "–"}</span>,
    }),
    histCol.accessor((r) => `${r.entity}.${r.action}`, {
      id: "what",
      header: () => t("member.what"),
      meta: { mobileLabel: t("member.what") },
      cell: (c) => (
        <span className="whitespace-nowrap">
          {has(`member.entity.${c.row.original.entity}`)
            ? t(`member.entity.${c.row.original.entity}`)
            : c.row.original.entity}{" "}
          <span className="text-muted-foreground">
            {has(`member.action.${c.row.original.action}`)
              ? t(`member.action.${c.row.original.action}`)
              : c.row.original.action}
          </span>
        </span>
      ),
    }),
    histCol.display({
      id: "changes",
      header: () => t("member.changes"),
      meta: { mobileLabel: t("member.changes") },
      cell: (c) => <Changes item={c.row.original} />,
    }),
  ]
  return (
    <DataTable
      data={data}
      columns={columns}
      getRowId={(r) => String(r.id)}
      pageSize={25}
      search
      empty={t("member.no_history")}
    />
  )
}

/** "Field: old → new" per changed field, formatted like the change log, then the reason. */
function Changes({ item }: { item: Rev }) {
  const { label, value, reason } = useAuditFormat()
  const why = reason(item.reason)
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-sm">
      {item.changed.slice(0, 4).map((k) => (
        <span key={k} className="truncate">
          <span className="text-muted-foreground">{label(k)}:</span>{" "}
          <span className="tabular">{value(k, item.before?.[k])}</span>
          <span className="text-muted-foreground"> → </span>
          <span className="tabular">{value(k, item.after?.[k])}</span>
        </span>
      ))}
      {why ? <span className="truncate text-xs text-muted-foreground italic">{why}</span> : null}
    </div>
  )
}
