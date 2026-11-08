/**
 * Week view: one row per day with work and break segments on a 0–24 h axis, the day's total and its
 * difference to the target, holidays, absences, findings and signed-off months. Segments are buttons
 * (edit) and carry their project's colour and name, so a day reads as one block split by project; clicking
 * an empty part of a track adds an entry at that time (rounded to 15 minutes). `needsProject` entries (work
 * without a required project) stand out in the warning tone with a dashed edge and "No project".
 */
import { FolderX, Moon, PenLine, Sun } from "lucide-react"
import type { MouseEvent } from "react"
import { Duration, InProgress } from "@/components/data/duration"
import { fmtDay, fmtMinutes, fmtWeekdayShort } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { useNow } from "../clock/use-now"
import { projectShort } from "../projects/project-picker"
import type { Correction, PeriodView } from "./api"
import { dayFindings } from "./day-findings"
import { DayChips, FindingsBadge, LockMark } from "./day-marks"
import type { Day, Entry } from "./entry-dialog"
import { fmtClockTime, minToHhmm, minutesOfDay, wallClock } from "./lib"

interface Segment {
  entry: Entry
  from: number
  to: number
}

/** Entries split into per-day segments (minutes of the local day); running entries end now. */
function segmentsByDay(entries: Entry[], tz: string, now: number): Map<string, Segment[]> {
  const out = new Map<string, Segment[]>()
  for (const e of entries) {
    if (e.deleted) continue
    const endAt = e.endAt ?? new Date(now > 0 ? now : Date.parse(e.startAt) + e.minutes * 60000).toISOString()
    const s = wallClock(e.startAt, tz)
    const en = wallClock(endAt, tz)
    let d = s.date
    for (let guard = 0; d <= en.date && guard < 3; guard++) {
      const from = d === s.date ? minutesOfDay(e.startAt, tz) : 0
      const to = d === en.date ? minutesOfDay(endAt, tz) : 1440
      if (to > from || d === s.date) {
        const list = out.get(d) ?? []
        list.push({ entry: e, from, to: Math.max(to, from + 1) })
        out.set(d, list)
      }
      const next = new Date(`${d}T12:00:00Z`)
      next.setUTCDate(next.getUTCDate() + 1)
      d = next.toISOString().slice(0, 10)
    }
  }
  return out
}

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]
const pct = (min: number) => `${(min / 1440) * 100}%`

export function WeekTimeline({
  view,
  corrections,
  needsProject,
  onEdit,
  onAdd,
}: {
  view: PeriodView
  corrections: Record<number, Correction>
  needsProject?: ReadonlySet<number>
  onEdit: (e: Entry) => void
  onAdd: (date: string, start?: string) => void
}) {
  const { t, intl } = useI18n()
  const me = useMe()
  const hour12 = me.timeFormat === "12h"
  const tz = view.user.timezone
  const running = view.entries.some((e) => e.running)
  const now = useNow(running)
  const segs = segmentsByDay(view.entries, tz, now)
  const nowMin = now > 0 ? minutesOfDay(now, tz) : 0

  const clickTrack = (ev: MouseEvent<HTMLButtonElement>, d: Day) => {
    const rect = ev.currentTarget.getBoundingClientRect()
    const m = Math.round((((ev.clientX - rect.left) / rect.width) * 1440) / 15) * 15
    onAdd(d.date, minToHhmm(Math.min(m, 1425)))
  }

  return (
    <div className="flex flex-col">
      <div className="hidden grid-cols-[9rem_1fr_7.5rem] gap-4 pb-1 md:grid" aria-hidden>
        <span />
        <div className="relative h-4 text-[11px] text-muted-foreground tabular">
          {TICKS.map((h) => (
            <span
              key={h}
              className={cn("absolute -translate-x-1/2", h === 0 && "translate-x-0", h === 24 && "-translate-x-full")}
              style={{ left: pct(h * 60) }}
            >
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
        <span />
      </div>
      {view.days.map((d) => {
        const lock = view.lockedMonths[d.date.slice(0, 7)]
        const list = segs.get(d.date) ?? []
        const isToday = d.date === view.today
        const findings = dayFindings(d, view.findings)
        const approvedAbsence = d.absences.some((a) => a.status === "approved")
        const editable = view.canEdit && !lock && !d.isFuture
        const hasFigures = !d.isFuture && (d.targetMin > 0 || d.workedMin > 0)
        return (
          <div
            key={d.date}
            data-day={d.date}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 border-b py-3 last:border-b-0 md:grid-cols-[9rem_1fr_7.5rem] md:py-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className={cn("flex items-center gap-1.5 text-sm font-medium", isToday && "text-primary")}>
                {fmtWeekdayShort(d.date, intl)} {fmtDay(d.date, intl, { day: "numeric", month: "numeric" })}
                <LockMark lock={lock} />
                {!d.projectOk ? (
                  <span className="size-1.5 rounded-full bg-warning" title={t("time.project_missing")}>
                    <span className="sr-only">{t("time.project_missing")}</span>
                  </span>
                ) : null}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {d.scheduledMin > 0 ? t("time.target_short", { t: fmtMinutes(d.targetMin) }) : t("time.free")}
              </span>
              {/* findings belong to the day, like the lock and the missing-project mark */}
              <FindingsBadge findings={findings} className="mt-1 self-start" />
            </div>

            <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
              <div
                className={cn(
                  "relative h-8 overflow-hidden rounded-md bg-muted/50",
                  d.holiday && "bg-holiday/10",
                  approvedAbsence && "bg-absent/10",
                )}
              >
                {editable ? (
                  // pointer shortcut to add at the clicked time; "Add entry" is the keyboard path
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    className="absolute inset-0 cursor-copy"
                    title={t("time.click_to_add")}
                    onClick={(ev) => clickTrack(ev, d)}
                  />
                ) : null}
                {TICKS.slice(1, -1).map((h) => (
                  <span
                    key={h}
                    className="absolute inset-y-0 w-px bg-border/60"
                    style={{ left: pct(h * 60) }}
                    aria-hidden
                  />
                ))}
                {list.length === 0 && (d.holiday || d.absences.length) ? (
                  <DayChips day={d} className="absolute inset-y-0 left-2 flex-nowrap" />
                ) : null}
                {list.map(({ entry: e, from, to }) => {
                  const corr = corrections[e.id]
                  const time = `${fmtClockTime(wallClock(e.startAt, tz).time, hour12)}–${e.endAt ? fmtClockTime(wallClock(e.endAt, tz).time, hour12) : "…"}`
                  const missing = needsProject?.has(e.id) ?? false
                  const what = missing ? t("time.no_project") : e.project?.name
                  const label = `${t(`time.kind.${e.kind}`)} ${time}${what ? ` · ${what}` : ""}${e.note ? ` · ${e.note}` : ""}${corr ? ` · ${t("time.changed_by", { name: corr.by })}` : ""}`
                  const marked = e.edited || e.source === "manual"
                  const short = e.project ? projectShort(e.project) : ""
                  return (
                    <button
                      key={`${e.id}-${from}`}
                      type="button"
                      onClick={() => onEdit(e)}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "@container absolute inset-y-1 flex items-center gap-1 overflow-hidden rounded-[5px] px-1.5 text-left text-[11px] font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        missing
                          ? "border-2 border-dashed border-warning bg-warning/15 text-warning hover:bg-warning/25"
                          : e.kind === "work"
                            ? "bg-work text-primary-foreground hover:bg-work/85"
                            : "bg-break/60 text-foreground hover:bg-break/75",
                        e.corrected && !missing && "ring-2 ring-warning ring-inset",
                        e.project && "pl-2.5",
                      )}
                      style={{ left: pct(from), width: `calc(${pct(to - from)} - 1px)` }}
                    >
                      {e.project ? (
                        // user-chosen project colour: data, not a theme colour
                        <span
                          className="absolute inset-y-0 left-0 w-1"
                          style={{ backgroundColor: e.project.color }}
                          aria-hidden
                        />
                      ) : null}
                      {/* labels by the block's rendered width, so a narrow phone timeline shows no fragments */}
                      {missing ? (
                        <>
                          <FolderX className="size-3 shrink-0" aria-hidden />
                          <span className="hidden shrink-0 font-semibold @min-[5.5rem]:inline">
                            {t("time.no_project")}
                          </span>
                        </>
                      ) : marked ? (
                        <PenLine className="hidden size-3 shrink-0 opacity-80 @min-[3rem]:block" aria-hidden />
                      ) : null}
                      {short ? <span className="hidden truncate @min-[1.5rem]:inline">{short}</span> : null}
                      <span
                        className={cn(
                          "hidden truncate tabular opacity-80",
                          missing ? "@min-[11rem]:inline" : short ? "@min-[6rem]:inline" : "@min-[4.25rem]:inline",
                        )}
                      >
                        {time}
                      </span>
                    </button>
                  )
                })}
                {isToday && now > 0 ? (
                  <span className="absolute inset-y-0 w-0.5 bg-today" style={{ left: pct(nowMin) }} aria-hidden />
                ) : null}
              </div>
              {list.length > 0 && (d.holiday || d.absences.length) ? <DayChips day={d} className="mt-1.5" /> : null}
            </div>

            <div className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 md:col-start-auto md:row-start-auto">
              <span className="text-sm font-semibold tabular">
                {d.workedMin > 0 || d.running ? fmtMinutes(d.workedMin) : "–"}
              </span>
              {hasFigures ? (
                d.isToday ? (
                  <InProgress />
                ) : (
                  <Duration minutes={d.deltaMin} balance className="text-xs" />
                )
              ) : null}
              {!d.isFuture ? <DayCredits day={d} /> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Time credits included in the difference: Sunday/holiday surcharge (time-credit mode) and regular night work. */
function DayCredits({ day }: { day: Day }) {
  const t = useI18n().t
  const items = [
    { min: day.surchargeMin, label: t("time.surcharge_credit"), Icon: Sun },
    { min: day.nightCreditMin, label: t("time.night_credit"), Icon: Moon },
  ].filter((c) => Math.round(c.min) > 0)
  if (!items.length) return null
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular">
      {items.map(({ min, label, Icon }) => (
        <span key={label} className="flex items-center gap-0.5" title={`${label} ${fmtMinutes(min, { sign: true })}`}>
          <Icon className="size-3" aria-hidden />
          <span className="sr-only">{label}</span>
          {fmtMinutes(min, { sign: true })}
        </span>
      ))}
    </span>
  )
}
