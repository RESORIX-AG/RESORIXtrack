/**
 * Team calendar: who is away when, one month at a time, as a month grid with initials coloured by type.
 * Sick leave of others arrives anonymised from the server ("Absent"). The day panel lists who is away on
 * the focused day. Used by /calendar (employees) and the team overview (managers).
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { type TransitionStartFunction, useId, useState } from "react"
import { AbsenceCalendar, CalendarLegend } from "@/components/app/absence-calendar"
import type { CalendarCell, CalendarMark } from "@/components/app/absence-calendar-cells"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { ColorDot } from "@/components/app/status-badge"
import { Combobox } from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import { teamCalendarQuery } from "@/features/team/api"
import { addMonthsStr, fmtDay, fmtMonth, initials, monthRange } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function TeamCalendarView({
  month,
  onMonth,
  today,
  teamId,
  onTeam,
  startTransition,
  className,
}: {
  /** YYYY-MM */
  month: string
  onMonth: (month: string) => void
  /** from the server (person's timezone) */
  today: string
  teamId?: number | null
  onTeam?: (teamId: number | null) => void
  /** when `month` is local state: from `useTransition()`, so the old month stays while the next loads */
  startTransition?: TransitionStartFunction
  className?: string
}) {
  const i = useI18n()
  const { t, intl, absenceLabel, holidayName } = i
  const { data: cal } = useSuspenseQuery(teamCalendarQuery({ ...monthRange(month), teamId: teamId ?? null }))
  const [day, setDay] = useState<string | null>(null)
  const dayTitleId = useId()
  const focused = day?.startsWith(month) ? day : today.startsWith(month) ? today : `${month}-01`

  const cells = new Map<string, CalendarCell>()
  const away = new Map<string, { name: string; mark: CalendarMark; typeLabel: string }[]>()
  const types = new Map<string, { key: string; color: string; label: string }>()
  const dates = cal.rows[0]?.days.map((d) => d.date) ?? []
  dates.forEach((date, idx) => {
    const marks: CalendarMark[] = []
    const list: { name: string; mark: CalendarMark; typeLabel: string }[] = []
    for (const r of cal.rows) {
      for (const a of r.days[idx].absences) {
        const typeLabel =
          a.typeKey === "absent" ? t("absences.team.absent") : absenceLabel({ key: a.typeKey, label: a.label })
        const half = a.halves.length === 1 ? a.halves[0] : null
        const mark: CalendarMark = {
          key: `${r.user.id}-${a.id ?? a.typeKey}`,
          color: a.color,
          text: initials(r.user.name),
          label: `${r.user.name}: ${typeLabel}${half ? `, ${t(`absences.half.${half}`)}` : ""}${a.status === "pending" ? ` (${t("absences.status.pending")})` : ""}`,
          pending: a.status === "pending",
          half,
        }
        marks.push(mark)
        list.push({ name: r.user.name, mark, typeLabel })
        types.set(a.typeKey, { key: a.typeKey, color: a.color, label: typeLabel })
      }
    }
    const first = cal.rows[0].days[idx]
    cells.set(date, { workday: cal.rows.some((r) => r.days[idx].workday), holiday: first.holiday, marks })
    away.set(date, list)
  })
  const dayList = away.get(focused) ?? []
  const holiday = cells.get(focused)?.holiday
  const teamItems = [
    { value: "all", label: t("absences.team.all_teams") },
    ...cal.teams.map((x) => ({ value: String(x.id), label: x.name })),
  ]

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onTeam && cal.teams.length > 1 ? (
          <Combobox
            className="mr-auto h-8 w-auto min-w-40"
            aria-label={t("common.team")}
            options={teamItems}
            value={teamId ? String(teamId) : "all"}
            onChange={(v) => onTeam(v === "all" || v == null ? null : Number(v))}
          />
        ) : null}
        <PeriodNav
          label={fmtMonth(month, intl)}
          onPrev={() => onMonth(addMonthsStr(month, -1))}
          onNext={() => onMonth(addMonthsStr(month, 1))}
          onToday={() => onMonth(today.slice(0, 7))}
          isCurrent={month === today.slice(0, 7)}
          startTransition={startTransition}
        />
      </div>

      {!cal.rows.length ? (
        <p className="rounded-xl border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {t("absences.team.no_members")}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex flex-col gap-4 rounded-xl border bg-card p-3 sm:p-5">
            <PeriodContent>
              <AbsenceCalendar
                month={month}
                days={cells}
                today={today}
                active={focused}
                onActiveChange={setDay}
                onSelect={setDay}
                onMonthChange={onMonth}
                selection={{ start: focused, end: focused }}
              />
            </PeriodContent>
            <CalendarLegend types={[...types.values()]} />
          </div>
          <section
            aria-live="polite"
            className="flex flex-col gap-3 self-start rounded-xl border bg-card p-4"
            aria-labelledby={dayTitleId}
          >
            <h3 id={dayTitleId} className="text-sm font-semibold">
              {fmtDay(focused, intl, { weekday: "long", day: "numeric", month: "long" })}
            </h3>
            {holiday ? <p className="text-sm text-holiday">{holidayName(holiday.name)}</p> : null}
            {dayList.length ? (
              <ul className="flex flex-col gap-2">
                {dayList.map((x) => (
                  <li key={x.mark.key} className="flex items-center gap-2 text-sm">
                    <ColorDot color={x.mark.color} />
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {x.typeLabel}
                      {x.mark.half ? ` · ${t(`absences.half_short.${x.mark.half}`)}` : ""}
                      {x.mark.pending ? ` · ${t("absences.status.pending")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("absences.team.nobody")}</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export function TeamCalendarSkeleton() {
  return <Skeleton className="h-96 rounded-xl" />
}
