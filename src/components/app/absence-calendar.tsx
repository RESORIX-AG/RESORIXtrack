/**
 * Month grid for absences (own calendar, request picker, team calendar). Weeks start on Monday. Each day
 * shows holidays, days off, absences coloured by their type with a short text (type or initials), and
 * today. Keyboard: one tab stop per calendar; arrows move by day/week, Home/End to the week edges,
 * PageUp/PageDown by month, Enter/Space selects. Crossing into a neighbouring month moves focus there
 * when that month is rendered (year view) or asks for it via `onMonthChange`.
 */
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { addDaysStr, addMonthsStr, fmtDay, fmtMonth, mondayOf } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { type CalendarCell, type CalendarMark, monthDays } from "./absence-calendar-cells"

export interface AbsenceCalendarProps {
  /** YYYY-MM */
  month: string
  days: ReadonlyMap<string, CalendarCell>
  today: string
  size?: "md" | "sm"
  selection?: { start: string; end: string } | null
  /** controlled roving focus (one tab stop across several grids); internal when omitted */
  active?: string | null
  onActiveChange?: (date: string) => void
  onSelect?: (date: string) => void
  onMonthChange?: (month: string) => void
  /** show the month name above the grid */
  caption?: boolean
  maxMarks?: number
  className?: string
}

const MONDAY = "2024-01-01"

function weeksOf(month: string): (string | null)[][] {
  const days = monthDays(month)
  const start = mondayOf(days[0])
  const weeks: (string | null)[][] = []
  for (let w = start; w <= days[days.length - 1]; w = addDaysStr(w, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDaysStr(w, i)).map((d) => (d.startsWith(month) ? d : null)))
  }
  return weeks
}

function keyTarget(e: KeyboardEvent, date: string): string | null {
  const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
  switch (e.key) {
    case "ArrowLeft":
      return addDaysStr(date, -1)
    case "ArrowRight":
      return addDaysStr(date, 1)
    case "ArrowUp":
      return addDaysStr(date, -7)
    case "ArrowDown":
      return addDaysStr(date, 7)
    case "Home":
      return addDaysStr(date, -wd)
    case "End":
      return addDaysStr(date, 6 - wd)
    case "PageUp":
    case "PageDown": {
      const m = addMonthsStr(date.slice(0, 7), e.key === "PageUp" ? -1 : 1)
      const days = monthDays(m)
      const last = days[days.length - 1]
      const d = `${m}-${date.slice(8)}`
      return d > last ? last : d
    }
    default:
      return null
  }
}

const tint = (color: string, pct: number) => `color-mix(in oklch, ${color} ${pct}%, transparent)`

function markStyle(m: CalendarMark): CSSProperties {
  return {
    backgroundColor: tint(m.color, m.pending ? 10 : 26),
    borderColor: m.color,
  }
}

/** Fill for the compact (year) cells: the first mark's colour, half the cell for half days. */
function compactFill(m: CalendarMark | undefined): CSSProperties | undefined {
  if (!m) return undefined
  const c = tint(m.color, m.pending ? 18 : 42)
  if (m.half === "am") return { backgroundImage: `linear-gradient(90deg, ${c} 50%, transparent 50%)` }
  if (m.half === "pm") return { backgroundImage: `linear-gradient(90deg, transparent 50%, ${c} 50%)` }
  return { backgroundColor: c }
}

export function AbsenceCalendar({
  month,
  days,
  today,
  size = "md",
  selection,
  active: activeProp,
  onActiveChange,
  onSelect,
  onMonthChange,
  caption,
  maxMarks = 3,
  className,
}: AbsenceCalendarProps) {
  const { t, intl, holidayName } = useI18n()
  const root = useRef<HTMLTableElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const [own, setOwn] = useState<string | null>(null)
  const active = activeProp !== undefined ? activeProp : own
  const setActive = (d: string) => {
    if (activeProp === undefined) setOwn(d)
    onActiveChange?.(d)
  }
  const weeks = weeksOf(month)
  const inMonth = (d: string | null | undefined): d is string => Boolean(d?.startsWith(month))
  // the one tab stop: the active day, else today, else the selection start, else the 1st
  const tabStop = inMonth(active)
    ? active
    : activeProp !== undefined && activeProp !== null
      ? null
      : inMonth(today)
        ? today
        : inMonth(selection?.start)
          ? selection.start
          : `${month}-01`

  useEffect(() => {
    const d = pendingFocus.current
    if (d?.startsWith(month)) {
      pendingFocus.current = null
      root.current?.querySelector<HTMLButtonElement>(`[data-cal-date="${d}"]`)?.focus()
    }
  }, [month])

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const from = e.currentTarget.dataset.calDate
    if (!from) return
    const target = keyTarget(e, from)
    if (!target) return
    e.preventDefault()
    const scope = root.current?.closest("[data-cal-scope]") ?? root.current
    const btn = scope?.querySelector<HTMLButtonElement>(`[data-cal-date="${target}"]`)
    if (btn) {
      btn.focus()
      return
    }
    if (onMonthChange) {
      pendingFocus.current = target
      setActive(target)
      onMonthChange(target.slice(0, 7))
    }
  }

  const weekdays = Array.from({ length: 7 }, (_, i) => addDaysStr(MONDAY, i))
  const compact = size === "sm"
  const sel = selection && selection.start <= selection.end ? selection : null

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {caption ? (
        <p className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{fmtMonth(month, intl)}</p>
      ) : null}
      <table
        ref={root}
        aria-label={fmtMonth(month, intl)}
        className="w-full table-fixed border-separate border-spacing-0.5"
      >
        <thead>
          <tr>
            {weekdays.map((d) => (
              <th
                key={d}
                scope="col"
                abbr={fmtDay(d, intl, { weekday: "long" })}
                className="pb-1 text-center text-xs font-medium text-muted-foreground"
              >
                {fmtDay(d, intl, { weekday: compact ? "narrow" : "short" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={week.find(Boolean) ?? w}>
              {week.map((date, i) => {
                // padding before the 1st / after the last: the weekday column is the cell's identity
                // oxlint-disable-next-line react/no-array-index-key
                if (!date) return <td key={i} aria-hidden />
                const cell = days.get(date)
                const marks = cell?.marks ?? []
                const off = cell ? !cell.workday && !cell.holiday : i >= 5
                const isToday = date === today
                const selected = Boolean(sel && date >= sel.start && date <= sel.end)
                const label = [
                  fmtDay(date, intl, { weekday: "long", day: "numeric", month: "long" }),
                  cell?.holiday ? `${holidayName(cell.holiday.name)}${cell.holiday.fraction < 1 ? " ½" : ""}` : null,
                  ...marks.map((m) => m.label),
                ]
                  .filter(Boolean)
                  .join(", ")
                return (
                  <td key={date} className="p-0 align-top">
                    <button
                      type="button"
                      data-cal-date={date}
                      tabIndex={date === tabStop ? 0 : -1}
                      aria-label={label}
                      aria-current={isToday ? "date" : undefined}
                      aria-pressed={sel ? selected : undefined}
                      title={compact ? label : undefined}
                      onFocus={() => setActive(date)}
                      onKeyDown={onKeyDown}
                      onClick={() => onSelect?.(date)}
                      className={cn(
                        "relative w-full rounded-md outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                        compact
                          ? "flex h-9 items-center justify-center text-xs tabular hover:bg-accent"
                          : "flex min-h-14 flex-col items-stretch gap-1 p-1 text-left hover:bg-accent sm:min-h-20 sm:p-1.5",
                        off && (compact ? "text-faint-foreground" : "bg-muted/50 text-muted-foreground"),
                        cell?.holiday && "bg-holiday/12",
                        selected &&
                          (compact
                            ? "bg-primary/30 hover:bg-primary/40"
                            : "bg-brand-soft ring-1 ring-primary/50 hover:bg-brand-soft"),
                        compact && isToday && "font-semibold text-primary ring-1 ring-primary",
                      )}
                      style={compact && !selected ? compactFill(marks[0]) : undefined}
                    >
                      {compact ? (
                        <span className={cn(cell?.holiday && "font-semibold text-holiday")}>
                          {Number(date.slice(8))}
                        </span>
                      ) : (
                        <>
                          <span className="flex items-center gap-1">
                            <span
                              className={cn(
                                "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular",
                                isToday && "bg-primary font-semibold text-primary-foreground",
                              )}
                            >
                              {Number(date.slice(8))}
                            </span>
                            {cell?.holiday ? (
                              <span className="hidden truncate text-xs text-holiday sm:inline">
                                {holidayName(cell.holiday.name)}
                              </span>
                            ) : null}
                          </span>
                          {cell?.holiday ? (
                            <span className="mx-1 h-0.5 rounded-full bg-holiday sm:hidden" aria-hidden />
                          ) : null}
                          {marks.slice(0, maxMarks).map((m) => (
                            <span
                              key={m.key}
                              aria-hidden
                              style={markStyle(m)}
                              className={cn(
                                "flex h-1.5 min-w-0 items-center gap-0.5 rounded-sm border-l-[3px] sm:h-auto sm:rounded-md sm:px-1 sm:py-0.5",
                                m.pending && "border border-l-[3px] border-dashed",
                                m.half === "am" && "mr-[50%] sm:mr-0",
                                m.half === "pm" && "ml-[50%] sm:ml-0",
                              )}
                            >
                              <span className="hidden truncate text-xs leading-4 font-medium sm:inline">{m.text}</span>
                              {m.half ? (
                                <span className="hidden shrink-0 text-xs leading-4 text-muted-foreground sm:inline">
                                  {t(`absences.half_short.${m.half}`)}
                                </span>
                              ) : null}
                            </span>
                          ))}
                          {marks.length > maxMarks ? (
                            <span aria-hidden className="px-1 text-xs text-muted-foreground tabular">
                              +{marks.length - maxMarks}
                            </span>
                          ) : null}
                        </>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Legend under a calendar: the types shown plus holiday, pending and today. */
export function CalendarLegend({
  types,
  className,
}: {
  types: { key: string; color: string; label: string }[]
  className?: string
}) {
  const { t } = useI18n()
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {types.map((x) => (
        <li key={x.key} className="flex items-center gap-1.5">
          <span
            className="size-3 rounded-sm border-l-[3px]"
            style={{ backgroundColor: tint(x.color, 26), borderColor: x.color }}
            aria-hidden
          />
          {x.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-holiday/40" aria-hidden />
        {t("absences.legend.holiday")}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-dashed border-muted-foreground" aria-hidden />
        {t("absences.legend.pending")}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-muted" aria-hidden />
        {t("absences.legend.off")}
      </li>
    </ul>
  )
}
