/**
 * A member's week or month for their lead/HR: entries per day (click to correct; a reason is required and
 * logged), totals, findings and locked months. Editing uses the time feature's entry dialog.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { Lock, Plus } from "lucide-react"
import { useState } from "react"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { Segmented } from "@/components/app/segmented"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { Duration, InProgress, TodayHint } from "@/components/data/duration"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type PeriodView, periodQuery } from "@/features/time/api"
import { type Entry, EntryDialog, type EntryTarget } from "@/features/time/entry-dialog"
import { EntryHistoryDialog } from "@/features/time/entry-history"
import { fmtClockTime, todayIn, wallClock } from "@/features/time/lib"
import { addDaysStr, addMonthsStr, fmtDay, fmtDayRange, fmtMinutes, fmtMonth, mondayOf } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { MemberSearch } from "./member-page"
import { memberPeriodParams } from "./search"

type Day = PeriodView["days"][number] & { entries: Entry[]; findings: PeriodView["findings"] }
const col = tableHelper<Day>()

export function TimePanel({
  userId,
  search,
  onSearch,
}: {
  userId: number
  search: MemberSearch
  onSearch: (s: Partial<MemberSearch>) => void
}) {
  const i = useI18n()
  const { t, intl } = i
  const me = useMe()
  const hour12 = me.timeFormat === "12h"
  const today = todayIn(me.timezone)
  const view: "week" | "month" = search.month ? "month" : "week"
  const params = memberPeriodParams(userId, search, today)
  // the route loader fetches the next period before the URL commits, so a step never suspends here
  const { data: p } = useSuspenseQuery(periodQuery(params))
  const [target, setTarget] = useState<EntryTarget | null>(null)
  const [history, setHistory] = useState<Entry | null>(null)

  const rows: Day[] = (() => {
    const byDay = new Map<string, Entry[]>()
    for (const e of p.entries) {
      const d = wallClock(e.startAt, p.user.timezone).date
      byDay.set(d, [...(byDay.get(d) ?? []), e])
    }
    return p.days.map((d) => ({
      ...d,
      entries: byDay.get(d.date) ?? [],
      findings: p.findings.filter((f) => f.date === d.date),
    }))
  })()

  const ctx = {
    owner: p.user,
    self: false,
    today: p.today,
    lockedMonths: p.lockedMonths,
    reasonRequired: p.reasonRequired,
    canEdit: p.canEdit,
    entries: p.entries,
  }

  const columns = [
    col.accessor("date", {
      header: () => t("common.date"),
      enableSorting: false,
      meta: { primary: true, className: "whitespace-nowrap" },
      cell: (c) => {
        const locked = p.lockedMonths[c.getValue().slice(0, 7)]
        return (
          <span className="inline-flex items-center gap-2 tabular">
            <span className="w-9 text-muted-foreground">{fmtDay(c.getValue(), intl, { weekday: "short" })}</span>
            {fmtDay(c.getValue(), intl, { day: "2-digit", month: "2-digit" })}
            {locked ? <Lock className="size-3.5 text-muted-foreground" aria-label={t("member.locked")} /> : null}
          </span>
        )
      },
    }),
    col.display({
      id: "entries",
      header: () => t("reports.times"),
      meta: { mobileLabel: t("reports.times") },
      cell: (c) => {
        const d = c.row.original
        return (
          <div className="flex flex-wrap items-center gap-1">
            {d.holiday ? <StatusBadge tone="negative">{i.holidayName(d.holiday.name)}</StatusBadge> : null}
            {d.absences.map((a) => (
              <StatusBadge key={a.id} tone="absent" icon={a.status === "pending" ? "pending" : null}>
                <ColorDot color={a.color} />
                {i.absenceLabel({ key: a.typeKey, label: a.label })}
                {a.halves.length === 1 ? " ½" : ""}
              </StatusBadge>
            ))}
            {d.entries.map((e) => {
              const time = `${fmtClockTime(wallClock(e.startAt, p.user.timezone).time, hour12)}–${e.endAt ? fmtClockTime(wallClock(e.endAt, p.user.timezone).time, hour12) : "…"}`
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setTarget({ entry: e, date: d.date })
                  }}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm tabular transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    e.kind === "break" ? "bg-break/12 text-break" : "bg-muted",
                    e.corrected && "ring-1 ring-warning/60",
                  )}
                  aria-label={`${t(`time.kind.${e.kind}`)} ${time}${e.corrected ? ` · ${t("time.corrected")}` : ""}`}
                  title={t("member.edit_entry")}
                >
                  {time}
                </button>
              )
            })}
            {d.findings.map((f) => (
              <Tooltip key={`${f.rule}-${f.severity}`}>
                <TooltipTrigger render={<span />}>
                  <StatusBadge
                    tone={f.severity === "violation" ? "negative" : f.severity === "warning" ? "warning" : "info"}
                    icon="warning"
                  >
                    {t(`compliance.rule.${f.rule}`)}
                  </StatusBadge>
                </TooltipTrigger>
                <TooltipContent>{f.ref}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )
      },
    }),
    col.accessor("workedMin", {
      header: () => t("reports.worked"),
      enableSorting: false,
      meta: { numeric: true, mobileLabel: t("reports.worked") },
      cell: (c) => (c.getValue() ? fmtMinutes(c.getValue()) : ""),
    }),
    col.accessor("targetMin", {
      header: () => t("reports.target"),
      enableSorting: false,
      meta: { numeric: true, mobileLabel: t("reports.target"), className: "text-muted-foreground" },
      cell: (c) => (c.getValue() ? fmtMinutes(c.getValue()) : ""),
    }),
    col.accessor("deltaMin", {
      header: () => t("reports.delta"),
      enableSorting: false,
      meta: { numeric: true, mobileLabel: t("reports.delta") },
      cell: (c) => {
        const d = c.row.original
        if (d.isFuture || !(d.workedMin || d.targetMin)) return ""
        return d.isToday ? <InProgress /> : <Duration minutes={c.getValue()} balance />
      },
    }),
    col.display({
      id: "add",
      header: () => <span className="sr-only">{t("member.add_entry")}</span>,
      meta: { className: "w-12" },
      cell: (c) =>
        p.canEdit && !c.row.original.isFuture && !p.lockedMonths[c.row.original.date.slice(0, 7)] ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("member.add_entry_on", { date: fmtDay(c.row.original.date, intl) })}
            onClick={(ev) => {
              ev.stopPropagation()
              setTarget({ date: c.row.original.date })
            }}
          >
            <Plus />
          </Button>
        ) : null,
    }),
  ]

  const anchor = search.month || mondayOf(search.week ?? today)
  const label =
    view === "month"
      ? fmtMonth(anchor, intl)
      : fmtDayRange(anchor, addDaysStr(anchor, 6), intl, { day: "numeric", month: "short", year: "numeric" })
  const move = (n: number) =>
    view === "month" ? onSearch({ month: addMonthsStr(anchor, n) }) : onSearch({ week: addDaysStr(anchor, 7 * n) })
  const isCurrent = view === "month" ? anchor === today.slice(0, 7) : anchor === mondayOf(today)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={view}
          onValueChange={(v) =>
            onSearch(
              v === "month"
                ? { month: (search.week ?? today).slice(0, 7), week: undefined }
                : { month: undefined, week: undefined },
            )
          }
          aria-label={t("member.view")}
          options={[
            { value: "week", label: t("member.week") },
            { value: "month", label: t("member.month") },
          ]}
        />
        <PeriodNav
          label={label}
          onPrev={() => move(-1)}
          onNext={() => move(1)}
          onToday={() => onSearch({ week: undefined, month: view === "month" ? today.slice(0, 7) : undefined })}
          isCurrent={isCurrent}
        />
      </div>
      <PeriodContent className="flex flex-col gap-4">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t("reports.worked")}</dt>
            <dd className="tabular">
              {fmtMinutes(p.summary.workedCompleteMin)}
              <TodayHint minutes={p.summary.todayWorkedMin} className="ml-1.5" />
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t("reports.target")}</dt>
            <dd className="tabular">{fmtMinutes(p.summary.targetMin)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t("reports.delta")}</dt>
            <dd>
              <Duration minutes={p.summary.deltaMin} balance />
            </dd>
          </div>
        </dl>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(d) => d.date}
          pageSize={40}
          rowClassName={(d) =>
            cn(d.date === p.today && "bg-brand-soft", !d.isWorkday && !d.workedMin && "text-muted-foreground")
          }
        />
      </PeriodContent>
      {target ? (
        <EntryDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          target={target}
          ctx={ctx}
          onHistory={(e) => setHistory(e)}
        />
      ) : null}
      <EntryHistoryDialog
        open={history != null}
        onOpenChange={(o) => !o && setHistory(null)}
        entry={history}
        tz={p.user.timezone}
        self={false}
      />
    </div>
  )
}
