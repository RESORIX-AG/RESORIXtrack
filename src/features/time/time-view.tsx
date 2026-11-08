/**
 * "My time" (and a member's time for leads/HR via `userId`): week timeline or month calendar and the period's
 * entries, each with its project. State lives in the URL: `view`, `date`, `add=1` (opens the add
 * dialog; the command palette uses it), `deleted=1` (show deleted entries), `fix=project` (marks past work in
 * open months without a project and scrolls to `date`; the dashboard's reminder links here).
 */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderOpen, Lock, Plus } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { Section } from "@/components/app/page"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { Segmented } from "@/components/app/segmented"
import { Duration, TodayHint } from "@/components/data/duration"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { addDaysStr, addMonthsStr, fmtDay, fmtDayRange, fmtMinutes, fmtMonth, mondayOf } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { correctionsQuery, periodQuery, restoreEntryFn } from "./api"
import { FindingsBadge } from "./day-marks"
import { EntriesTable } from "./entries-table"
import { entryContext } from "./entry-context"
import { type Entry, EntryDialog, type EntryTarget } from "./entry-dialog"
import { EntryHistoryDialog } from "./entry-history"
import { invalidateTimeData } from "./invalidate"
import { todayIn, wallClock } from "./lib"
import { MonthView } from "./month-view"
import { Notice } from "./notice"
import { periodParams, type TimeSearch } from "./period"
import { WeekTimeline } from "./week-timeline"

export function TimeView({
  userId,
  search,
  onSearch,
}: {
  userId?: number | null
  search: TimeSearch
  onSearch: (next: TimeSearch) => void
}) {
  const showDeletedId = useId()
  const { t, tError, intl } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const today = todayIn(me.timezone)
  const mode = search.view ?? "week"
  const anchor = search.date ?? today
  const q = useQuery({ ...periodQuery(periodParams(userId, search, today)), placeholderData: keepPreviousData })
  const view = q.data
  const correctedIds = view?.entries.filter((e) => e.corrected).map((e) => e.id) ?? []
  const corrections = useQuery(correctionsQuery({ userId: view?.user.id, ids: correctedIds })).data ?? {}
  const fixing = search.fix === "project"
  // as sign-off counts them: past days of months still open
  const unassigned =
    fixing && view
      ? view.entries.filter((e) => {
          const date = wallClock(e.startAt, view.user.timezone).date
          return (
            e.kind === "work" &&
            e.projectId == null &&
            !e.deleted &&
            !e.running &&
            date < view.today &&
            !view.lockedMonths[date.slice(0, 7)]
          )
        })
      : []
  const needsProject = new Set(unassigned.map((e) => e.id))
  const loaded = view != null
  useEffect(() => {
    if (fixing && loaded && search.date)
      document.querySelector(`[data-day="${search.date}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [fixing, loaded, search.date])

  const [target, setTarget] = useState<EntryTarget>({ date: today })
  const [editOpen, setEditOpenRaw] = useState(false)
  const [seq, setSeq] = useState(0)
  const setEditOpen = (open: boolean) => {
    if (open) setSeq((n) => n + 1)
    setEditOpenRaw(open)
  }
  const [historyEntry, setHistoryEntry] = useState<Entry | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  if (!view) return <TimeViewSkeleton />

  const self = view.user.id === me.id
  // ?add=1 (command palette) opens the add dialog; closing it clears the parameter
  const adding = Boolean(search.add) && !editOpen
  const closeOrOpen = (open: boolean) => {
    if (!open && search.add) onSearch({ ...search, add: undefined })
    setEditOpen(open)
  }
  const openAdd = (date: string, start?: string) => {
    setTarget({ date: date > view.today ? view.today : date, start })
    setEditOpen(true)
  }
  const openEdit = (entry: Entry) => {
    setTarget({ entry, date: wallClock(entry.startAt, view.user.timezone).date })
    setEditOpen(true)
  }
  const openHistory = (entry: Entry) => {
    setEditOpen(false)
    setHistoryEntry(entry)
    setHistoryOpen(true)
  }
  const restore = async (entry: Entry, reason = "") => {
    try {
      await restoreEntryFn({ data: { id: entry.id, reason } })
      await invalidateTimeData(qc)
      toast.success(t("time.restored"))
    } catch (err) {
      toast.error(tError(err))
    }
  }

  const restoreNeedsReason = (e: Entry) =>
    view.reasonRequired.always ||
    (view.reasonRequired.pastDays && wallClock(e.startAt, view.user.timezone).date < view.today)

  const go = (patch: TimeSearch) => onSearch({ ...search, ...patch })
  const shift = (n: number) =>
    go({ date: mode === "week" ? addDaysStr(mondayOf(anchor), 7 * n) : `${addMonthsStr(anchor.slice(0, 7), n)}-01` })
  const isCurrent =
    mode === "week" ? mondayOf(anchor) === mondayOf(view.today) : anchor.slice(0, 7) === view.today.slice(0, 7)
  const label =
    mode === "week"
      ? fmtDayRange(view.from, view.to, intl, { day: "numeric", month: "short", year: "numeric" })
      : fmtMonth(anchor.slice(0, 7), intl)
  const weekFindings = view.findings.filter((f) => f.week && !f.date)
  const locks = Object.entries(view.lockedMonths)
  const s = view.summary

  return (
    <div className="flex flex-col gap-6">
      {locks.map(([month, lock]) => (
        <Notice key={month} icon={Lock} tone="positive">
          {t("time.locked_banner", {
            month: fmtMonth(month, intl),
            name: lock.signedBy ?? "?",
            date: fmtDay(wallClock(lock.signedAt, me.timezone).date, intl),
          })}
        </Notice>
      ))}
      {fixing ? (
        unassigned.length ? (
          <Notice
            icon={FolderOpen}
            tone="info"
            action={
              view.canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    openEdit(
                      unassigned.find((e) => wallClock(e.startAt, view.user.timezone).date === search.date) ??
                        unassigned[0],
                    )
                  }
                >
                  {t("dashboard.project_fix")}
                </Button>
              ) : null
            }
          >
            {t("time.project_fix_hint", { count: unassigned.length })}
          </Notice>
        ) : (
          <Notice icon={FolderOpen} tone="positive">
            {t("time.project_fix_done")}
          </Notice>
        )
      ) : null}

      <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5" aria-label={label}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Segmented
            value={mode}
            onValueChange={(v) => go({ view: v === "month" ? "month" : undefined })}
            aria-label={t("time.view")}
            options={[
              { value: "week", label: t("time.week") },
              { value: "month", label: t("time.month") },
            ]}
          />
          <PeriodNav
            label={label}
            onPrev={() => shift(-1)}
            onNext={() => shift(1)}
            onToday={() => go({ date: undefined })}
            isCurrent={isCurrent}
          />
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:ml-auto" aria-live="polite">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{t("time.worked")}</dt>
              <dd className="font-semibold tabular">
                {fmtMinutes(s.workedCompleteMin)}
                <TodayHint minutes={s.todayWorkedMin} className="ml-1.5" />
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{t("time.target")}</dt>
              <dd className="font-semibold tabular">{fmtMinutes(s.targetMin)}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">{t("time.delta")}</dt>
              <dd className="font-semibold">
                <Duration minutes={s.deltaMin} balance />
              </dd>
            </div>
            {weekFindings.length ? <FindingsBadge findings={weekFindings} /> : null}
          </dl>
          {view.canEdit ? (
            <Button
              onClick={() =>
                openAdd(
                  mode === "week" && anchor < view.today && mondayOf(anchor) !== mondayOf(view.today)
                    ? anchor
                    : view.today,
                )
              }
            >
              <Plus data-icon="inline-start" />
              {t("time.add_entry")}
            </Button>
          ) : null}
        </div>
        <PeriodContent className={q.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          {mode === "week" ? (
            <WeekTimeline
              view={view}
              corrections={corrections}
              needsProject={needsProject}
              onEdit={openEdit}
              onAdd={openAdd}
            />
          ) : (
            <MonthView view={view} onPick={(date) => go({ view: undefined, date })} />
          )}
        </PeriodContent>
        {mode === "week" ? <Legend missingProject={needsProject.size > 0} /> : null}
      </section>

      <Section title={t("time.entries")}>
        <EntriesTable
          entries={view.entries}
          tz={view.user.timezone}
          corrections={corrections}
          needsProject={needsProject}
          canEdit={view.canEdit}
          onEdit={openEdit}
          onHistory={openHistory}
          // the table has no reason field: entries whose restore needs a reason open in the dialog
          onRestore={(e) => (restoreNeedsReason(e) ? openEdit(e) : restore(e))}
          toolbar={
            <div className="flex items-center gap-2">
              <Switch
                id={showDeletedId}
                checked={Boolean(search.deleted)}
                onCheckedChange={(v) => go({ deleted: v || undefined })}
              />
              <Label htmlFor={showDeletedId} className="text-sm font-normal text-muted-foreground">
                {t("time.show_deleted")}
              </Label>
            </div>
          }
        />
      </Section>

      <EntryDialog
        key={adding ? "add" : seq}
        open={editOpen || adding}
        onOpenChange={closeOrOpen}
        target={adding ? { date: view.today } : target}
        ctx={entryContext(view, self)}
        correction={target.entry ? corrections[target.entry.id] : undefined}
        onHistory={openHistory}
        onRestore={restore}
      />
      <EntryHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entry={historyEntry}
        tz={view.user.timezone}
        self={self}
      />
    </div>
  )
}

function Legend({ missingProject }: { missingProject: boolean }) {
  const { t } = useI18n()
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground md:justify-end">
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-work" aria-hidden />
        {t("time.legend_work")}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm ring-2 ring-warning ring-inset" aria-hidden />
        {t("time.legend_corrected")}
      </li>
      {missingProject ? (
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-dashed border-warning bg-warning/15" aria-hidden />
          {t("time.project_missing")}
        </li>
      ) : null}
    </ul>
  )
}

export function TimeViewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <Skeleton className="h-8 w-80 max-w-full" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}
