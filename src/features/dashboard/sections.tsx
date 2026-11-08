/** Dashboard building blocks below the clock card: key figures, the week chart, absences, hints. */
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, ChevronRight, FolderOpen } from "lucide-react"
import type { ReactNode } from "react"
import { SectionBoundary } from "@/components/app/section-boundary"
import { AbsenceStatusBadge, ColorDot } from "@/components/app/status-badge"
import { DayBarsChart } from "@/components/data/charts"
import { Duration } from "@/components/data/duration"
import { StatCard, StatGrid } from "@/components/data/stat"
import { ButtonLink } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { absencesQuery } from "@/features/absences/api"
import type { Clock } from "@/features/clock/clock-control"
import { liveWorkedMin } from "@/features/clock/use-clock"
import { useNow } from "@/features/clock/use-now"
import { findingsQuery, yearFindingsQuery } from "@/features/compliance/api"
import type { fetchTimeOverview } from "@/features/time/api"
import { Notice } from "@/features/time/notice"
import { addDaysStr, fmtDay, fmtDayRange, fmtDays, fmtMinutes, fmtWeekdayShort } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type Overview = Awaited<ReturnType<typeof fetchTimeOverview>>

/** A dashboard card: tint + hairline, title row with an optional link. */
export function Card({
  title,
  link,
  children,
  className,
}: {
  title: ReactNode
  link?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {link}
      </div>
      {children}
    </section>
  )
}

function CardLink({ to, children, search }: { to: string; children: ReactNode; search?: Record<string, unknown> }) {
  return (
    <ButtonLink variant="link" size="sm" className="h-auto px-0" render={<Link to={to} search={search} />}>
      {children}
    </ButtonLink>
  )
}

function TileLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-xl transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>div]:h-full [&>div]:hover:bg-muted/40"
    >
      {children}
    </Link>
  )
}

export function StatTiles({ overview, clock, className }: { overview: Overview; clock: Clock; className?: string }) {
  const { t, intl } = useI18n()
  const c = clock.data
  const now = useNow(c?.state === "working")
  const todayWorked = c ? Math.max(liveWorkedMin(c, now), 0) : overview.today.workedMin
  const extra = Math.max(0, todayWorked - overview.today.workedMin)
  const week = overview.week.summary
  const weekWorked = week.workedMin + extra
  const v = overview.vacation
  return (
    <StatGrid className={className}>
      <StatCard
        label={t("dashboard.today")}
        value={<span suppressHydrationWarning>{fmtMinutes(Math.floor(todayWorked))}</span>}
        hint={t("dashboard.of_target", { target: fmtMinutes(overview.today.targetMin) })}
        progress={overview.today.targetMin ? todayWorked / overview.today.targetMin : 0}
      />
      <StatCard
        label={t("dashboard.this_week")}
        value={<span suppressHydrationWarning>{fmtMinutes(Math.floor(weekWorked))}</span>}
        hint={t("dashboard.of_target", { target: fmtMinutes(week.targetTotalMin) })}
        progress={week.targetTotalMin ? weekWorked / week.targetTotalMin : 0}
      />
      <TileLink to="/account">
        <StatCard
          label={t("dashboard.balance")}
          value={<Duration minutes={overview.balance.balanceMin} balance />}
          hint={t("dashboard.balance_hint", { date: fmtDay(overview.balance.asOf, intl) })}
        />
      </TileLink>
      <TileLink to="/absences">
        <StatCard
          label={t("dashboard.vacation")}
          value={fmtDays(v.remaining)}
          unit={t("common.days")}
          hint={t("dashboard.vacation_hint", { taken: fmtDays(v.taken), planned: fmtDays(v.planned) })}
        />
      </TileLink>
    </StatGrid>
  )
}

export function WeekCard({ overview }: { overview: Overview }) {
  const { t, intl } = useI18n()
  const today = overview.today.date
  const days = overview.week.days.map((d) => ({
    label: fmtWeekdayShort(d.date, intl),
    minutes: d.workedMin,
    targetMinutes: d.targetMin,
    isToday: d.date === today,
  }))
  return (
    <Card
      title={t("dashboard.week_title")}
      link={<CardLink to="/time">{t("dashboard.open_time")}</CardLink>}
      className="lg:col-span-2"
    >
      <DayBarsChart
        days={days}
        ariaLabel={t("dashboard.week_title")}
        height={220}
        legend={{
          reached: t("dashboard.legend_reached"),
          worked: t("dashboard.legend_worked"),
          target: t("dashboard.legend_target"),
        }}
      />
    </Card>
  )
}

export function UpcomingCard({ userId, today }: { userId: number; today: string }) {
  const { t } = useI18n()
  return (
    <Card
      title={t("dashboard.upcoming")}
      link={
        <CardLink to="/absences" search={{ request: "1" }}>
          {t("dashboard.request")}
        </CardLink>
      }
    >
      <SectionBoundary fallback={<UpcomingSkeleton />}>
        <UpcomingList userId={userId} today={today} />
      </SectionBoundary>
    </Card>
  )
}

function UpcomingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  )
}

function UpcomingList({ userId, today }: { userId: number; today: string }) {
  const { t, intl, absenceLabel } = useI18n()
  const { data } = useSuspenseQuery(
    absencesQuery({ userId, from: today, to: addDaysStr(today, 365), status: ["pending", "approved"] }),
  )
  const list = data.filter((a) => a.endDate >= today).slice(0, 4)
  const span = (a: { startDate: string; endDate: string }) =>
    fmtDayRange(a.startDate, a.endDate, intl, {
      day: "numeric",
      month: "short",
      ...(a.endDate.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }),
    })
  if (!list.length) return <p className="text-sm text-muted-foreground">{t("dashboard.no_upcoming")}</p>
  return (
    <ul className="flex flex-col">
      {list.map((a) => (
        <li key={a.id} className="flex items-center gap-3 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0">
          <ColorDot color={a.type.color} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{absenceLabel(a.type)}</p>
            <p className="text-xs text-muted-foreground tabular">
              {span(a)} · {t("absences.n_days", { count: a.days, n: fmtDays(a.days) })}
            </p>
          </div>
          <AbsenceStatusBadge status={a.status} label={t(`absences.status.${a.status}`)} />
        </li>
      ))}
    </ul>
  )
}

/** Labour-law findings of the last two weeks and of the year; nothing when there are none. */
export function ComplianceHints({ today }: { today: string }) {
  // streams in after the page; most days there is nothing to show, so it reserves no space meanwhile
  return (
    <SectionBoundary fallback={null}>
      <ComplianceNotice today={today} />
    </SectionBoundary>
  )
}

function ComplianceNotice({ today }: { today: string }) {
  const { t, intl } = useI18n()
  const [{ data: recent }, { data: year }] = useSuspenseQueries({
    queries: [
      findingsQuery({ from: addDaysStr(today, -13), to: today }),
      yearFindingsQuery({ year: Number(today.slice(0, 4)) }),
    ],
  })
  const items = [
    ...recent.findings.filter((f) => f.severity !== "info"),
    ...year.findings.filter((f) => f.severity !== "info"),
  ]
  if (!items.length) return null
  const shown = items.slice(0, 3)
  return (
    <Notice icon={AlertTriangle} tone="warning">
      <span className="font-medium">{t("dashboard.findings", { count: items.length })}</span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {shown.map((f) => {
          const date = f.date ?? f.week
          return (
            <li key={`${f.rule}${date ?? f.year}`} className="text-muted-foreground">
              {date ? (
                <Link to="/time" search={{ date }} className="underline-offset-4 hover:text-foreground hover:underline">
                  {t(`compliance.rule.${f.rule}`)} ·{" "}
                  {fmtDay(date, intl, { weekday: "short", day: "numeric", month: "short" })}
                </Link>
              ) : (
                <>
                  {t(`compliance.rule.${f.rule}`)} · {f.year}
                </>
              )}
            </li>
          )
        })}
        {items.length > shown.length ? <li className="text-muted-foreground">+{items.length - shown.length}</li> : null}
      </ul>
    </Notice>
  )
}

/** A recent past day with work that has no project (projects required). */
export function ProjectReminder({ day }: { day: string | null }) {
  const { t, intl } = useI18n()
  if (!day) return null
  return (
    <Notice
      icon={FolderOpen}
      tone="info"
      action={
        <ButtonLink variant="ghost" size="sm" render={<Link to="/time" search={{ date: day, fix: "project" }} />}>
          {t("dashboard.project_fix")}
          <ChevronRight data-icon="inline-end" />
        </ButtonLink>
      }
    >
      {t("dashboard.project_missing", { date: fmtDay(day, intl, { weekday: "long", day: "numeric", month: "long" }) })}
    </Notice>
  )
}
