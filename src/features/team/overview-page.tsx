/**
 * Team overview for leads, deputies and HR: who is in now, who is away, month figures, balance, vacation,
 * sign-off and labour-law findings per person, plus the team calendar.
 */
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState, useTransition } from "react"
import { Page, PageHeader, Section } from "@/components/app/page"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { SectionBoundary } from "@/components/app/section-boundary"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { PersonAvatar } from "@/components/app/user-menu"
import { DataTable } from "@/components/data/data-table"
import { Duration } from "@/components/data/duration"
import { StatCard, StatGrid } from "@/components/data/stat"
import { tableHelper } from "@/components/data/table-helper"
import { TeamCalendarSkeleton, TeamCalendarView } from "@/features/absences/team-calendar-view"
import { TeamFilter } from "@/features/reports/controls"
import { addMonthsStr, fmtDay, fmtDays, fmtMinutes, fmtMonth, fmtTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { TeamOverview } from "@/server/services/team"
import { teamOverviewQuery, teamScopeQuery } from "./api"

type Member = TeamOverview["members"][number]
type Brief = Member["absencesThisWeek"][number]
const col = tableHelper<Member>()

export interface TeamSearch {
  team?: number
  month?: string
}

function Presence({ m }: { m: Member }) {
  const i = useI18n()
  const me = useMe()
  const out = m.absentToday.find((a) => a.status === "approved") ?? m.absentToday[0]
  if (m.presence.state !== "off") {
    const since = fmtTime(m.presence.since, { intl: i.intl, tz: me.timezone, hour12: me.timeFormat === "12h" })
    return (
      <StatusBadge tone="positive" icon="dot">
        {i.t("team.working_since", { time: since })}
      </StatusBadge>
    )
  }
  if (out) {
    return (
      <StatusBadge tone="absent" icon={out.status === "pending" ? "pending" : null}>
        <ColorDot color={out.type.color} />
        {i.absenceLabel(out.type)}
      </StatusBadge>
    )
  }
  return <span className="text-sm text-muted-foreground">{i.t("team.off")}</span>
}

function WeekAbsences({ items }: { items: Brief[] }) {
  const i = useI18n()
  if (!items.length) return <span className="text-muted-foreground">–</span>
  const day = (d: string) => fmtDay(d, i.intl, { weekday: "short" })
  return (
    <span className="flex flex-col gap-0.5 text-sm">
      {items.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ColorDot color={a.type.color} />
          {i.absenceLabel(a.type)}
          <span className="text-muted-foreground">
            {a.startDate === a.endDate ? day(a.startDate) : `${day(a.startDate)}–${day(a.endDate)}`} ·{" "}
            {fmtDays(a.daysThisWeek)}
          </span>
        </span>
      ))}
    </span>
  )
}

function Findings({ counts }: { counts: Member["findings"] }) {
  const { t } = useI18n()
  if (!counts || (!counts.violation && !counts.warning)) return <span className="text-muted-foreground">–</span>
  return (
    <span className="flex gap-1">
      {counts.violation ? (
        <StatusBadge tone="negative" icon="warning" className="tabular">
          {counts.violation}
          <span className="sr-only">{t("compliance.severity.violation")}</span>
        </StatusBadge>
      ) : null}
      {counts.warning ? (
        <StatusBadge tone="warning" className="tabular">
          {counts.warning}
          <span className="sr-only">{t("compliance.severity.warning")}</span>
        </StatusBadge>
      ) : null}
    </span>
  )
}

export function TeamOverviewPage({
  search,
  onSearch,
}: {
  search: TeamSearch
  onSearch: (s: Partial<TeamSearch>) => void
}) {
  const i = useI18n()
  const { t, intl } = i
  const navigate = useNavigate()
  const { data: scope } = useSuspenseQuery(teamScopeQuery)
  const params = { teamId: search.team ?? null, month: search.month ?? null }
  const { data: ov, isPlaceholderData } = useQuery({ ...teamOverviewQuery(params), placeholderData: keepPreviousData })
  if (!ov) throw new Error("team overview not loaded")
  const currentMonth = ov.today.slice(0, 7)
  const [calMonth, setCalMonth] = useState(currentMonth)
  const [calendarPending, startCalendar] = useTransition()
  const isCurrent = ov.month === currentMonth
  const columns = [
    col.accessor((m) => m.user.name, {
      id: "name",
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={c.getValue()} className="size-8" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{c.getValue()}</span>
            {c.row.original.user.teamName ? (
              <span className="block truncate text-xs text-muted-foreground">{c.row.original.user.teamName}</span>
            ) : null}
          </span>
        </span>
      ),
    }),
    col.accessor((m) => m.presence.state, {
      id: "now",
      header: () => t("team.now"),
      meta: { mobileLabel: t("team.now"), width: "9rem" },
      cell: (c) => <Presence m={c.row.original} />,
    }),
    col.accessor((m) => m.month.workedCompleteMin, {
      id: "worked",
      header: () => t("team.worked_target"),
      meta: { numeric: true, mobileLabel: t("team.worked_target"), width: "10rem" },
      cell: (c) => (
        <span className="whitespace-nowrap">
          {fmtMinutes(c.getValue())}
          <span className="text-muted-foreground"> / {fmtMinutes(c.row.original.month.targetMin)}</span>
        </span>
      ),
    }),
    col.accessor("balanceMin", {
      header: () => t("team.balance"),
      meta: { numeric: true, mobileLabel: t("team.balance"), width: "8rem" },
      cell: (c) => <Duration minutes={c.getValue()} balance />,
    }),
    col.accessor((m) => m.vacation.remaining, {
      id: "vacation",
      header: () => t("team.vacation_left"),
      meta: { numeric: true, mobileLabel: t("team.vacation_left"), width: "8rem" },
      cell: (c) => fmtDays(c.getValue()),
    }),
    col.accessor((m) => m.absencesThisWeek.length, {
      id: "week",
      header: () => t("team.out_week"),
      meta: { mobileLabel: t("team.out_week"), width: "10rem" },
      cell: (c) => <WeekAbsences items={c.row.original.absencesThisWeek} />,
    }),
    // a running month cannot be signed off yet: the column only shows for past months
    ...(isCurrent
      ? []
      : [
          col.accessor("signedOff", {
            header: () => t("team.signoff"),
            meta: { mobileLabel: t("team.signoff"), width: "8rem" },
            cell: (c) =>
              c.getValue() ? (
                <StatusBadge tone="positive" icon="signed">
                  {t("signoff.signed")}
                </StatusBadge>
              ) : (
                <span className="text-muted-foreground">{isCurrent ? "–" : t("team.not_signed")}</span>
              ),
          }),
        ]),
    col.accessor((m) => (m.findings ? m.findings.violation * 1000 + m.findings.warning : 0), {
      id: "findings",
      header: () => t("team.findings"),
      meta: { mobileLabel: t("team.findings"), width: "8rem" },
      cell: (c) => <Findings counts={c.row.original.findings} />,
    }),
  ]
  const violations = ov.members.reduce((n, m) => n + (m.findings?.violation ?? 0), 0)
  return (
    <Page>
      <PageHeader
        title={t("team.title")}
        actions={<TeamFilter scope={scope} value={search.team} onChange={(team) => onSearch({ team })} />}
      />
      <StatGrid className="lg:grid-cols-3">
        <StatCard label={t("team.in_now")} value={ov.totals.working} unit={`/ ${ov.totals.people}`} />
        <StatCard label={t("team.out_today")} value={ov.totals.absentToday} />
        <StatCard
          label={t("team.violations")}
          value={violations}
          tone={violations ? "destructive" : "default"}
          hint={fmtMonth(ov.month, intl)}
          className="col-span-2 lg:col-span-1"
        />
      </StatGrid>
      <Section
        title={t("team.members")}
        actions={
          <PeriodNav
            label={fmtMonth(ov.month, intl)}
            onPrev={() => onSearch({ month: addMonthsStr(ov.month, -1) })}
            onNext={() => onSearch({ month: addMonthsStr(ov.month, 1) })}
            onToday={() => onSearch({ month: undefined })}
            isCurrent={isCurrent}
          />
        }
      >
        <PeriodContent className={cn("transition-opacity duration-150", isPlaceholderData && "opacity-60")}>
          <DataTable
            data={ov.members}
            columns={columns}
            getRowId={(m) => String(m.user.id)}
            pageSize={false}
            onRowClick={(m) => navigate({ to: "/team/member/$userId", params: { userId: m.user.id } })}
            search={ov.members.length > 12}
            searchPlaceholder={t("team.search")}
            empty={t("team.no_members")}
            rowClassName={(m) => (m.user.isActive ? undefined : "opacity-60")}
          />
        </PeriodContent>
      </Section>
      <Section title={t("team.calendar")}>
        <SectionBoundary fallback={<TeamCalendarSkeleton />}>
          <TeamCalendarView
            className={calendarPending ? "opacity-60 transition-opacity" : undefined}
            month={calMonth}
            onMonth={setCalMonth}
            startTransition={startCalendar}
            today={ov.today}
            teamId={search.team ?? null}
          />
        </SectionBoundary>
      </Section>
    </Page>
  )
}
