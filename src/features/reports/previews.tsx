/**
 * On-screen previews of the reports. The downloadable files (PDF/XLSX/CSV) are rendered on the server from
 * the same data (render/*).
 */
import { Link } from "@tanstack/react-router"
import { Lock, Pencil } from "lucide-react"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { HBarChart } from "@/components/data/charts"
import { DataTable } from "@/components/data/data-table"
import { Duration, InProgress, TodayHint } from "@/components/data/duration"
import { StatCard, StatGrid } from "@/components/data/stat"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtDateTime, fmtDay, fmtDayRange, fmtDays, fmtMinutes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import type {
  AbsencesReportData,
  BalancesData,
  ProjectHoursData,
  RawEntryRow,
  TimesheetData,
} from "@/server/services/reports"

function PersonLink({ id, name, link }: { id: number; name: string; link: boolean }) {
  if (!link) return <span className="font-medium">{name}</span>
  return (
    <Link
      to="/team/member/$userId"
      params={{ userId: id }}
      className="font-medium hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </Link>
  )
}

// ------------------------------------------------------------------ timesheet

type TsDay = TimesheetData["days"][number] & {
  times: TimesheetData["entries"][string]
  logs: TimesheetData["projectTime"][string]
}
const tsCol = tableHelper<TsDay>()

export function TimesheetPreview({ d, today }: { d: TimesheetData; today: string }) {
  const i = useI18n()
  const { t, intl } = i
  const me = useMe()
  const s = d.summary
  const rows = d.days.map((day) => ({
    ...day,
    times: (d.entries[day.date] ?? []).filter((e) => e.kind === "work"),
    logs: d.projectTime[day.date] ?? [],
  }))
  const columns = [
    tsCol.accessor("date", {
      header: () => t("common.date"),
      enableSorting: false,
      meta: { primary: true, className: "whitespace-nowrap" },
      cell: (c) => (
        <span className="tabular">
          <span className="inline-block w-9 text-muted-foreground">
            {fmtDay(c.getValue(), intl, { weekday: "short" })}
          </span>
          {fmtDay(c.getValue(), intl, { day: "2-digit", month: "2-digit" })}
        </span>
      ),
    }),
    tsCol.accessor("times", {
      header: () => t("reports.times"),
      enableSorting: false,
      meta: { mobileLabel: t("reports.times"), className: "tabular" },
      cell: (c) =>
        c.getValue().length ? (
          <span className="flex flex-wrap gap-x-2">
            {c.getValue().map((e) => (
              <span key={e.id} className="whitespace-nowrap" title={e.note || undefined}>
                {e.start}–{e.end ?? "…"}
                {e.edited ? (
                  <Pencil className="ml-0.5 inline size-3 text-warning" aria-label={t("reports.edited")} />
                ) : null}
              </span>
            ))}
          </span>
        ) : null,
    }),
    tsCol.display({
      id: "info",
      header: () => t("reports.info"),
      meta: { hideOnMobile: true },
      cell: (c) => {
        const day = c.row.original
        return (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              {day.holiday ? (
                <StatusBadge tone="negative">
                  {i.holidayName(day.holiday.name)}
                  {day.holiday.fraction < 1 ? " ½" : ""}
                </StatusBadge>
              ) : null}
              {day.absences.map((a) => (
                <StatusBadge
                  key={a.id}
                  tone={a.status === "approved" ? "absent" : "neutral"}
                  icon={a.status === "pending" ? "pending" : null}
                >
                  <ColorDot color={a.color} />
                  {i.absenceLabel({ key: a.typeKey, label: a.label })}
                  {a.halves.length === 1 ? " ½" : ""}
                </StatusBadge>
              ))}
              {day.warnings.includes("break_too_short") ? (
                <StatusBadge tone="warning" icon="warning">
                  {t("reports.break_warning")}
                </StatusBadge>
              ) : null}
            </div>
            {day.logs.map((w) => (
              <span key={w.entryId} className="text-xs text-muted-foreground">
                {w.project ? <span className="text-foreground">{w.project}</span> : null}
                {w.note ? ` ${w.note}` : ""} · {fmtMinutes(w.minutes)}
              </span>
            ))}
          </div>
        )
      },
    }),
    tsCol.accessor("breakMin", {
      header: () => t("reports.break"),
      enableSorting: false,
      meta: { numeric: true, hideOnMobile: true },
      cell: (c) => (c.getValue() ? fmtMinutes(c.getValue()) : ""),
    }),
    tsCol.accessor("workedMin", {
      header: () => t("reports.worked"),
      enableSorting: false,
      meta: { numeric: true, mobileLabel: t("reports.worked") },
      cell: (c) => (c.getValue() ? fmtMinutes(c.getValue()) : ""),
    }),
    tsCol.accessor("targetMin", {
      header: () => t("reports.target"),
      enableSorting: false,
      meta: { numeric: true, mobileLabel: t("reports.target"), className: "text-muted-foreground" },
      cell: (c) => (c.getValue() ? fmtMinutes(c.getValue()) : ""),
    }),
    tsCol.accessor("deltaMin", {
      header: () => t("reports.delta"),
      enableSorting: false,
      meta: { numeric: true, mobileLabel: t("reports.delta") },
      cell: (c) => {
        const day = c.row.original
        if (day.isFuture || !(day.workedMin || day.targetMin)) return ""
        return day.isToday ? <InProgress /> : <Duration minutes={day.deltaMin} balance />
      },
    }),
  ]
  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <StatCard
          label={t("reports.worked")}
          value={
            <>
              {fmtMinutes(s.workedCompleteMin)}
              <TodayHint minutes={s.todayWorkedMin} className="ml-2 text-sm tracking-normal" />
            </>
          }
          hint={t("reports.target_is", { target: fmtMinutes(s.targetMin) })}
        />
        <StatCard
          label={t("reports.delta")}
          value={<Duration minutes={s.deltaMin} balance />}
          hint={t("reports.workdays", { n: s.workdays })}
        />
        <StatCard
          label={t("reports.balance")}
          value={<Duration minutes={d.balanceAfterMin} balance />}
          hint={t("reports.balance_before", { value: fmtMinutes(d.balanceBeforeMin, { sign: true }) })}
        />
        <StatCard
          label={t("reports.vacation_left")}
          value={fmtDays(d.vacation.remaining)}
          unit={t("common.days")}
          hint={t("reports.vacation_hint", { taken: fmtDays(d.vacation.taken), planned: fmtDays(d.vacation.planned) })}
        />
      </StatGrid>
      {d.signoff ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge tone="positive" icon="signed">
            {t("reports.signed")}
          </StatusBadge>
          {t("reports.signed_by", {
            name: d.signoff.signedBy ?? "?",
            date: fmtDateTime(d.signoff.signedAt, { intl, tz: me.timezone, hour12: me.timeFormat === "12h" }),
          })}
        </p>
      ) : null}
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.date}
        pageSize={40}
        caption={`${d.user.name} · ${d.year}-${String(d.month).padStart(2, "0")}`}
        rowClassName={(r) =>
          cn(r.date === today && "bg-brand-soft", !r.isWorkday && !r.workedMin && "text-muted-foreground")
        }
      />
    </div>
  )
}

// ------------------------------------------------------------------ balances

type BalRow = BalancesData["rows"][number]
const balCol = tableHelper<BalRow>()

export function BalancesPreview({ d, link }: { d: BalancesData; link: boolean }) {
  const { t } = useI18n()
  const columns = [
    balCol.accessor("name", {
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => <PersonLink id={c.row.original.userId} name={c.getValue()} link={link} />,
    }),
    balCol.accessor((r) => r.team ?? "", {
      id: "team",
      header: () => t("common.team"),
      meta: { hideOnMobile: true, className: "text-muted-foreground" },
    }),
    balCol.accessor("targetMin", {
      header: () => t("reports.target"),
      meta: { numeric: true, mobileLabel: t("reports.target"), width: "8rem" },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    balCol.accessor("workedMin", {
      header: () => t("reports.worked"),
      meta: { numeric: true, mobileLabel: t("reports.worked"), width: "8rem" },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    balCol.accessor("deltaMin", {
      header: () => t("reports.delta"),
      meta: { numeric: true, mobileLabel: t("reports.delta"), width: "8rem" },
      cell: (c) => <Duration minutes={c.getValue()} balance />,
    }),
    balCol.accessor("balanceMin", {
      header: () => t("reports.balance"),
      meta: { numeric: true, mobileLabel: t("reports.balance"), width: "8rem" },
      cell: (c) => <Duration minutes={c.getValue()} balance className="font-semibold" />,
    }),
    balCol.accessor("vacationRemaining", {
      header: () => t("reports.vacation_left"),
      meta: { numeric: true, mobileLabel: t("reports.vacation_left"), width: "8rem" },
      cell: (c) => fmtDays(c.getValue()),
    }),
  ]
  const sorted = [...d.rows].sort((a, b) => b.balanceMin - a.balanceMin)
  return (
    <div className="flex flex-col gap-6">
      {d.rows.length > 1 ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold">{t("reports.balance")}</h2>
          <HBarChart
            rows={sorted.map((r) => ({ label: r.name, minutes: r.balanceMin }))}
            ariaLabel={t("reports.balance")}
            signed
          />
        </section>
      ) : null}
      <DataTable
        data={d.rows}
        columns={columns}
        getRowId={(r) => String(r.userId)}
        search={d.rows.length > 10}
        pageSize={false}
        empty={t("reports.nobody")}
      />
      <dl className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-sm">
        <dt className="text-muted-foreground">{t("common.total")}</dt>
        <dd>
          {t("reports.target")} <span className="tabular">{fmtMinutes(d.totals.targetMin)}</span>
        </dd>
        <dd>
          {t("reports.worked")} <span className="tabular">{fmtMinutes(d.totals.workedMin)}</span>
        </dd>
        <dd>
          {t("reports.delta")} <Duration minutes={d.totals.deltaMin} balance />
        </dd>
        <dd>
          {t("reports.balance")} <Duration minutes={d.totals.balanceMin} balance />
        </dd>
      </dl>
    </div>
  )
}

// ------------------------------------------------------------------ absences

type AbsSum = AbsencesReportData["summary"][number]
type AbsRow = AbsencesReportData["rows"][number]
const absCol = tableHelper<AbsRow>()
const sumCol = tableHelper<AbsSum>()

export function AbsencesPreview({ d, link }: { d: AbsencesReportData; link: boolean }) {
  const i = useI18n()
  const { t, intl } = i
  const summary = d.summary.filter((s) => s.total > 0)
  const sumColumns = [
    sumCol.accessor("name", {
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => <PersonLink id={c.row.original.userId} name={c.getValue()} link={link} />,
    }),
    ...d.types.map((ty) =>
      sumCol.accessor((r) => r.byType[ty.key] ?? 0, {
        id: `type-${ty.key}`,
        header: () => (
          <span className="inline-flex items-center gap-1.5">
            <ColorDot color={ty.color} />
            {i.absenceLabel(ty)}
          </span>
        ),
        meta: { numeric: true, mobileLabel: i.absenceLabel(ty) },
        cell: (c) => (c.getValue() ? fmtDays(c.getValue()) : <span className="text-muted-foreground">–</span>),
      }),
    ),
    sumCol.accessor("total", {
      header: () => t("common.total"),
      meta: { numeric: true, mobileLabel: t("common.total"), className: "font-semibold" },
      cell: (c) => fmtDays(c.getValue()),
    }),
  ]
  const half = (h: string) => (h === "full" ? "" : ` (${t(`reports.half.${h}`)})`)
  const columns = [
    absCol.accessor("name", {
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => <PersonLink id={c.row.original.userId} name={c.getValue()} link={link} />,
    }),
    absCol.accessor("type", {
      header: () => t("common.type"),
      meta: { mobileLabel: t("common.type") },
      cell: (c) => (
        <span className="inline-flex items-center gap-1.5">
          <ColorDot color={c.row.original.color} />
          {i.absenceLabel({ key: c.row.original.typeKey, label: c.getValue() })}
        </span>
      ),
    }),
    absCol.accessor("startDate", {
      header: () => t("reports.period"),
      meta: { mobileLabel: t("reports.period"), className: "whitespace-nowrap" },
      cell: (c) => {
        const r = c.row.original
        const withYear = { day: "numeric", month: "short", year: "numeric" } as const
        if (r.startDate === r.endDate) return `${fmtDay(r.startDate, intl, withYear)}${half(r.startHalf)}`
        if (r.startHalf === "full" && r.endHalf === "full") return fmtDayRange(r.startDate, r.endDate, intl, withYear)
        return `${fmtDay(r.startDate, intl)}${half(r.startHalf)} – ${fmtDay(r.endDate, intl, withYear)}${half(r.endHalf)}`
      },
    }),
    absCol.accessor("days", {
      header: () => t("common.days"),
      meta: { numeric: true, mobileLabel: t("common.days") },
      cell: (c) => fmtDays(c.getValue()),
    }),
    absCol.accessor("status", {
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) => (
        <StatusBadge
          tone={c.getValue() === "approved" ? "positive" : "warning"}
          icon={c.getValue() === "approved" ? "approved" : "pending"}
        >
          {t(`absences.status.${c.getValue()}`)}
        </StatusBadge>
      ),
    }),
  ]

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("reports.summary")}</h2>
        <DataTable
          data={summary}
          columns={sumColumns}
          getRowId={(r) => String(r.userId)}
          empty={d.rows.length ? t("reports.only_pending") : t("reports.no_absences")}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("reports.details")}</h2>
        <DataTable
          data={d.rows}
          columns={columns}
          getRowId={(r) => String(r.id)}
          search={d.rows.length > 10}
          initialSorting={[{ id: "startDate", desc: false }]}
          empty={t("reports.no_absences")}
        />
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ projects

type Proj = ProjectHoursData["projects"][number]
const projCol = tableHelper<Proj & { key: string }>()
const personCol = tableHelper<Proj["people"][number]>()

function projectKey(p: Proj): string {
  return `p:${p.projectId ?? "none"}`
}

export function ProjectsPreview({
  d,
  projectId,
  onProject,
  link,
}: {
  d: ProjectHoursData
  projectId?: number
  onProject: (id: number | undefined) => void
  link: boolean
}) {
  const { t } = useI18n()
  const name = (p: Proj) => p.name ?? t("reports.no_project")
  const selected =
    projectId != null ? d.projects.find((p) => p.kind === "project" && p.projectId === projectId) : undefined
  const columns = [
    projCol.accessor((r) => r.name ?? "", {
      id: "name",
      header: () => t("reports.project"),
      meta: { primary: true },
      cell: (c) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <ColorDot color={c.row.original.color || "var(--muted-foreground)"} />
          {name(c.row.original)}
          {c.row.original.code ? (
            <span className="text-xs font-normal text-muted-foreground">{c.row.original.code}</span>
          ) : null}
        </span>
      ),
    }),
    projCol.accessor((r) => r.team ?? "", {
      id: "team",
      header: () => t("common.team"),
      meta: { hideOnMobile: true, className: "text-muted-foreground" },
    }),
    projCol.accessor((r) => r.people.length, {
      id: "people",
      header: () => t("reports.people"),
      meta: { numeric: true, mobileLabel: t("reports.people") },
    }),
    projCol.accessor("minutes", {
      header: () => t("reports.logged"),
      meta: { numeric: true, mobileLabel: t("reports.logged"), className: "font-semibold" },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
  ]
  const peopleColumns = [
    personCol.accessor("name", {
      header: () => t("reports.person"),
      meta: { primary: true },
      cell: (c) => <PersonLink id={c.row.original.userId} name={c.getValue()} link={link} />,
    }),
    personCol.accessor("minutes", {
      header: () => t("reports.logged"),
      meta: { numeric: true, mobileLabel: t("reports.logged") },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
  ]
  if (selected) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => onProject(undefined)}>
            {t("reports.all_projects")}
          </Button>
          <span className="inline-flex items-center gap-2 font-semibold">
            <ColorDot color={selected.color} />
            {name(selected)}
          </span>
          <span className="text-sm text-muted-foreground tabular">{fmtMinutes(selected.minutes)}</span>
        </div>
        {selected.people.length > 1 ? (
          <section className="rounded-xl border bg-card p-5">
            <HBarChart
              rows={selected.people.map((p) => ({ label: p.name, minutes: p.minutes, color: selected.color }))}
              ariaLabel={name(selected)}
            />
          </section>
        ) : null}
        <DataTable data={selected.people} columns={peopleColumns} getRowId={(r) => String(r.userId)} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      {projectId != null ? <p className="text-sm text-muted-foreground">{t("reports.project_no_hours")}</p> : null}
      <StatGrid className="lg:grid-cols-3">
        <StatCard label={t("reports.logged")} value={fmtMinutes(d.totalMin)} />
        <StatCard label={t("reports.projects")} value={d.projects.length} />
        <StatCard
          label={t("reports.people")}
          value={d.people.filter((p) => p.minutes > 0).length}
          className="col-span-2 lg:col-span-1"
        />
      </StatGrid>
      {d.projects.length > 1 ? (
        <section className="rounded-xl border bg-card p-5">
          <HBarChart
            rows={d.projects
              .slice(0, 15)
              .map((p) => ({ label: name(p), minutes: p.minutes, color: p.color || undefined }))}
            ariaLabel={t("reports.projects")}
          />
        </section>
      ) : null}
      <DataTable
        data={d.projects.map((p) => ({ ...p, key: projectKey(p) }))}
        columns={columns}
        getRowId={(r) => r.key}
        onRowClick={(r) => r.kind === "project" && r.projectId != null && onProject(r.projectId)}
        empty={t("reports.no_logs")}
      />
    </div>
  )
}

// ------------------------------------------------------------------ raw entries

const rawCol = tableHelper<RawEntryRow>()

export function EntriesPreview({ rows }: { rows: RawEntryRow[] }) {
  const { t, intl } = useI18n()
  const columns = [
    rawCol.accessor("name", { header: () => t("common.name"), meta: { primary: true } }),
    rawCol.accessor("date", {
      header: () => t("common.date"),
      meta: { mobileLabel: t("common.date"), className: "whitespace-nowrap", width: "10rem" },
      cell: (c) => fmtDay(c.getValue(), intl, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }),
    }),
    rawCol.accessor("startLocal", {
      header: () => t("reports.times"),
      meta: { mobileLabel: t("reports.times"), className: "tabular whitespace-nowrap", width: "8.5rem" },
      cell: (c) => `${c.getValue().slice(11)}–${c.row.original.endLocal ? c.row.original.endLocal.slice(11) : "…"}`,
    }),
    rawCol.accessor("kind", {
      header: () => t("common.type"),
      meta: { mobileLabel: t("common.type") },
      cell: (c) => t(`reports.kind_${c.getValue()}`),
    }),
    rawCol.accessor("minutes", {
      header: () => t("reports.minutes"),
      meta: { numeric: true, mobileLabel: t("reports.minutes"), width: "7rem" },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    rawCol.accessor("source", {
      header: () => t("reports.source"),
      meta: { hideOnMobile: true, className: "text-muted-foreground" },
      cell: (c) => t(`reports.source_${c.getValue()}`),
    }),
    rawCol.display({
      id: "flags",
      header: () => t("reports.flags"),
      meta: { mobileLabel: t("reports.flags"), width: "11rem" },
      cell: (c) => (
        <span className="flex gap-1">
          {c.row.original.edited ? <StatusBadge tone="warning">{t("reports.edited")}</StatusBadge> : null}
          {c.row.original.deleted ? <StatusBadge tone="negative">{t("reports.deleted")}</StatusBadge> : null}
        </span>
      ),
    }),
  ]
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => String(r.entryId)}
      search
      pageSize={false}
      empty={t("reports.no_entries")}
      rowClassName={(r) => (r.deleted ? "opacity-60" : undefined)}
    />
  )
}

/** Small lock hint for months that are signed off (used in headers). */
export function SignedHint({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex items-center gap-1 text-xs text-muted-foreground" />}>
        <Lock className="size-3.5" aria-hidden />
        {label}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
