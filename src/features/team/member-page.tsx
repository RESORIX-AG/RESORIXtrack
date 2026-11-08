/**
 * One person for their lead or HR: key figures, time (read and correct, with reason), absences (record for
 * them), account (adjustments, entitlement), schedule, labour-law findings and the change history.
 */
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, FileText, Plus, UserCog } from "lucide-react"
import { useState } from "react"
import { Page, PageHeader } from "@/components/app/page"
import { RelativeTime } from "@/components/app/relative-time"
import { StatusBadge } from "@/components/app/status-badge"
import { PanelSkeleton, TabPanel } from "@/components/app/tab-panel"
import { TabStrip } from "@/components/app/tab-strip"
import { PersonAvatar } from "@/components/app/user-menu"
import { Duration, TodayHint } from "@/components/data/duration"
import { StatCard, StatGrid } from "@/components/data/stat"
import { Button, ButtonLink } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { absenceOverviewQuery } from "@/features/absences/api"
import { type RequestMode, RequestSheet } from "@/features/absences/request-sheet"
import { fmtDays, fmtMinutes, fmtTime } from "@/lib/format"
import { isOneOf } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { memberQuery } from "./api"
import { AccountPanel } from "./member-account"
import { AbsencesPanel, CompliancePanel, HistoryPanel, SchedulePanel } from "./member-panels"
import { TimePanel } from "./member-time"
import { MEMBER_TABS, type MemberTab } from "./search"

export interface MemberSearch {
  tab?: MemberTab
  /** a day in the week shown, or YYYY-MM for the month view */
  week?: string
  month?: string
}

function PresenceLine({ m }: { m: ReturnType<typeof useMember> }) {
  const i = useI18n()
  const me = useMe()
  if (m.presence.state !== "off") {
    const since = fmtTime(m.presence.since, { intl: i.intl, tz: me.timezone, hour12: me.timeFormat === "12h" })
    return (
      <StatusBadge tone="positive" icon="dot">
        {i.t("team.working_since", { time: since })}
      </StatusBadge>
    )
  }
  return m.lastActivity ? (
    <span>
      {i.t("member.last_activity")} <RelativeTime at={m.lastActivity} tz={me.timezone} />
    </span>
  ) : null
}

function useMember(userId: number) {
  return useSuspenseQuery(memberQuery(userId)).data
}

export function MemberPage({
  userId,
  search,
  onSearch,
}: {
  userId: number
  search: MemberSearch
  onSearch: (s: Partial<MemberSearch>) => void
}) {
  const { t } = useI18n()
  const me = useMe()
  const m = useMember(userId)
  const tab = search.tab ?? "time"
  const overview = useQuery(absenceOverviewQuery({ userId }))
  const [request, setRequest] = useState<RequestMode | null>(null)
  const u = m.user
  const canManage = m.permissions.manage
  return (
    <Page>
      <div className="-mb-3">
        <ButtonLink variant="ghost" size="sm" className="-ml-2 text-muted-foreground" render={<Link to="/team" />}>
          <ChevronLeft data-icon="inline-start" />
          {t("nav.team")}
        </ButtonLink>
      </div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <PersonAvatar name={u.name} className="size-10" />
            <span className="min-w-0 truncate">{u.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            {u.team ? <span>{u.team.name}</span> : null}
            {u.pensumPercent != null && u.pensumPercent < 100 ? (
              <span className="tabular">{u.pensumPercent} %</span>
            ) : null}
            {!u.isActive ? <StatusBadge>{t("common.inactive")}</StatusBadge> : null}
            <PresenceLine m={m} />
          </span>
        }
        actions={
          <>
            {me.isAdmin ? (
              <ButtonLink variant="ghost" render={<Link to="/admin/users/$userId" params={{ userId: u.id }} />}>
                <UserCog data-icon="inline-start" />
                {t("member.edit_employee")}
              </ButtonLink>
            ) : null}
            <ButtonLink variant="outline" render={<Link to="/reports" search={{ tab: "timesheet", user: u.id }} />}>
              <FileText data-icon="inline-start" />
              {t("member.timesheet")}
            </ButtonLink>
            {canManage ? (
              <Button onClick={() => setRequest({ kind: "new" })}>
                <Plus data-icon="inline-start" />
                {t("member.record_absence")}
              </Button>
            ) : null}
          </>
        }
      />
      <StatGrid>
        <StatCard label={t("team.balance")} value={<Duration minutes={m.balance.balanceMin} balance />} />
        <StatCard
          label={t("team.vacation_left")}
          value={fmtDays(m.vacation.remaining)}
          unit={t("common.days")}
          hint={t("member.vacation_of", {
            total: fmtDays(m.vacation.entitlement + m.vacation.carriedOver),
            year: m.vacation.year,
          })}
        />
        <StatCard
          label={t("member.this_month")}
          value={
            <>
              {fmtMinutes(m.month.workedCompleteMin)}
              <TodayHint minutes={m.month.todayWorkedMin} className="ml-2 text-sm tracking-normal" />
            </>
          }
          hint={t("member.target", { value: fmtMinutes(m.month.targetMin) })}
          progress={m.month.targetMin ? m.month.workedCompleteMin / m.month.targetMin : undefined}
        />
        <StatCard label={t("member.delta_month")} value={<Duration minutes={m.month.deltaMin} balance />} />
      </StatGrid>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (isOneOf(MEMBER_TABS, v)) onSearch({ tab: v === "time" ? undefined : v })
        }}
        className="gap-6"
      >
        <TabStrip>
          <TabsList variant="line">
            {MEMBER_TABS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`member.tab.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </TabStrip>
        <TabPanel value="time" active={tab === "time"} fallback={<PanelSkeleton />}>
          <TimePanel userId={u.id} search={search} onSearch={onSearch} />
        </TabPanel>
        <TabPanel value="absences" active={tab === "absences"} fallback={<PanelSkeleton />}>
          <AbsencesPanel userId={u.id} onEdit={(a) => setRequest({ kind: "edit", absence: a })} />
        </TabPanel>
        <TabPanel value="account" active={tab === "account"} fallback={<PanelSkeleton />}>
          <AccountPanel userId={u.id} />
        </TabPanel>
        <TabPanel value="schedule" active={tab === "schedule"} fallback={<PanelSkeleton />}>
          <SchedulePanel userId={u.id} />
        </TabPanel>
        <TabPanel value="compliance" active={tab === "compliance"} fallback={<PanelSkeleton />}>
          <CompliancePanel userId={u.id} />
        </TabPanel>
        <TabPanel value="history" active={tab === "history"} fallback={<PanelSkeleton />}>
          <HistoryPanel userId={u.id} />
        </TabPanel>
      </Tabs>
      {request && overview.data ? (
        <RequestSheet
          open
          onOpenChange={(o) => !o && setRequest(null)}
          mode={request}
          ctx={{
            today: overview.data.today,
            sickBackdateDays: overview.data.sickBackdateDays,
            sickMaxDays: overview.data.sickMaxDays,
            userId: u.id,
            self: false,
          }}
        />
      ) : null}
    </Page>
  )
}
