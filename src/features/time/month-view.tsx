/**
 * Month view: a calendar on wide screens, a list of days on phones. Each day shows its total, the
 * difference to the target, holidays/absences, findings, the work-log state and locks. Choosing a day
 * opens its week.
 */
import { Duration, InProgress } from "@/components/data/duration"
import { fmtDay, fmtMinutes, fmtWeekdayShort } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { PeriodView } from "./api"
import { dayFindings } from "./day-findings"
import { DayChips, FindingsBadge, LockMark } from "./day-marks"
import type { Day } from "./entry-dialog"

const WEEKDAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]

export function MonthView({ view, onPick }: { view: PeriodView; onPick: (date: string) => void }) {
  const { t, intl } = useI18n()
  const lead = view.days.length ? view.days[0].weekday : 0
  const label = (d: Day) => fmtDay(d.date, intl, { weekday: "long", day: "numeric", month: "long" })
  return (
    <>
      {/* calendar (md and up) */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 gap-1.5 pb-1.5" aria-hidden>
          {WEEKDAYS.map((d) => (
            <span key={d} className="px-2 text-xs font-medium text-muted-foreground uppercase">
              {fmtWeekdayShort(d, intl)}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`pad${i}`} aria-hidden />
          ))}
          {view.days.map((d) => {
            const findings = dayFindings(d, view.findings)
            const hasFigures = !d.isFuture && (d.targetMin > 0 || d.workedMin > 0)
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onPick(d.date)}
                aria-label={label(d)}
                className={cn(
                  "flex min-h-24 flex-col items-stretch gap-1 rounded-lg border bg-card p-2 text-left transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  !d.isWorkday && !d.holiday && "bg-muted/30",
                  d.date === view.today && "border-primary",
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "text-sm font-medium tabular",
                      d.date === view.today && "text-primary",
                      !d.isWorkday && "text-muted-foreground",
                    )}
                  >
                    {Number(d.date.slice(8))}
                  </span>
                  <span className="flex items-center gap-1">
                    {!d.projectOk ? (
                      <span className="size-1.5 rounded-full bg-warning">
                        <span className="sr-only">{t("time.project_missing")}</span>
                      </span>
                    ) : null}
                    {d.running ? (
                      <span className="size-1.5 rounded-full bg-work">
                        <span className="sr-only">{t("time.running")}</span>
                      </span>
                    ) : null}
                    <LockMark lock={view.lockedMonths[d.date.slice(0, 7)]} className="size-3" />
                  </span>
                </span>
                {d.workedMin > 0 ? (
                  <span className="text-base font-semibold tabular">{fmtMinutes(d.workedMin)}</span>
                ) : null}
                <DayDelta day={d} show={hasFigures} />
                <DayChips day={d} className="mt-auto" />
                {findings.length ? <FindingsBadge findings={findings} className="self-start" plain /> : null}
              </button>
            )
          })}
        </div>
      </div>

      {/* list (phones) */}
      <ul className="flex flex-col md:hidden">
        {view.days.map((d) => {
          const findings = dayFindings(d, view.findings)
          const hasFigures = !d.isFuture && (d.targetMin > 0 || d.workedMin > 0)
          return (
            <li key={d.date} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(d.date)}
                aria-label={label(d)}
                className="flex min-h-12 w-full items-center gap-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "w-14 shrink-0 text-sm",
                    d.date === view.today
                      ? "font-semibold text-primary"
                      : !d.isWorkday
                        ? "text-muted-foreground"
                        : "font-medium",
                  )}
                >
                  {fmtWeekdayShort(d.date, intl)} {Number(d.date.slice(8))}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <DayChips day={d} compact={d.absences.length + (d.holiday ? 1 : 0) > 1} />
                  {findings.length ? <FindingsBadge findings={findings} plain /> : null}
                  {!d.projectOk ? (
                    <span className="size-1.5 rounded-full bg-warning">
                      <span className="sr-only">{t("time.project_missing")}</span>
                    </span>
                  ) : null}
                  <LockMark lock={view.lockedMonths[d.date.slice(0, 7)]} className="size-3" />
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-sm font-semibold tabular">
                    {d.workedMin > 0 ? fmtMinutes(d.workedMin) : "–"}
                  </span>
                  <DayDelta day={d} show={hasFigures} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function DayDelta({ day, show }: { day: Day; show: boolean }) {
  if (!show) return null
  return day.isToday ? <InProgress /> : <Duration minutes={day.deltaMin} balance className="text-xs" />
}
