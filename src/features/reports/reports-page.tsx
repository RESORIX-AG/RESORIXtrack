/**
 * Reports: one tab per report, filters in the URL (shareable, command palette links to
 * `?tab=projects&project=<id>`), on-screen preview and downloads (PDF to sign, XLSX, CSV).
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { Page, PageHeader } from "@/components/app/page"
import { PeriodContent } from "@/components/app/period-nav"
import { TabPanel } from "@/components/app/tab-panel"
import { TabStrip } from "@/components/app/tab-strip"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { teamScopeQuery } from "@/features/team/api"
import { useToday } from "@/features/team/use-today"
import { useDeferredParams } from "@/hooks/use-deferred-params"
import { isOneOf } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { useBootstrap, useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { CompliancePreview } from "./compliance-preview"
import {
  DownloadButtons,
  type Format,
  MonthNav,
  PersonPicker,
  RangePicker,
  TeamFilter,
  useDownload,
  YearMonthPicker,
} from "./controls"
import { AbsencesPreview, BalancesPreview, EntriesPreview, ProjectsPreview, TimesheetPreview } from "./previews"
import { REPORT_TABS, type ReportSearch, type ReportTab, reportQuery, resolveReport, tabsFor } from "./search"

function Filters({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  )
}

export function ReportsPage({
  search,
  onSearch,
}: {
  search: ReportSearch
  onSearch: (patch: Partial<ReportSearch>) => void
}) {
  const { t } = useI18n()
  const me = useMe()
  const b = useBootstrap()
  const today = useToday()
  const tabs = tabsFor(me, b.company.projectMode !== "off")
  const r = resolveReport(search, me, today, tabs)
  const { busy, download } = useDownload()
  // reports are expensive on the server: a tab renders once visited, then stays alive (filters, sort, scroll)
  const [visited, setVisited] = useState<ReadonlySet<ReportTab>>(() => new Set([r.tab]))
  if (!visited.has(r.tab)) setVisited(new Set([...visited, r.tab]))

  const downloadParams: Record<string, string | number | null | undefined> =
    r.tab === "timesheet" ? r.timesheet : r.tab === "balances" ? r.balances : r.range_
  const formats: Format[] = r.tab === "entries" ? ["xlsx", "csv"] : ["pdf", "xlsx", "csv"]

  return (
    <Page>
      <PageHeader
        title={t("reports.title")}
        actions={
          <DownloadButtons formats={formats} busy={busy} onDownload={(f) => download(r.tab, downloadParams, f)} />
        }
      />
      <Tabs
        value={r.tab}
        onValueChange={(v) => {
          if (isOneOf(REPORT_TABS, v)) onSearch({ tab: v, project: undefined })
        }}
        className="gap-6"
      >
        {tabs.length > 1 ? (
          <TabStrip>
            <TabsList variant="line">
              {tabs.map((k) => (
                <TabsTrigger key={k} value={k}>
                  {t(`reports.tab.${k}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </TabStrip>
        ) : null}
        {tabs.map((k) =>
          visited.has(k) ? (
            <TabPanel
              key={k}
              value={k}
              active={k === r.tab}
              fallback={<PreviewSkeleton />}
              className="flex flex-col gap-6"
            >
              <ReportPanel tab={k} tabs={tabs} today={today} search={search} onSearch={onSearch} />
            </TabPanel>
          ) : null,
        )}
      </Tabs>
    </Page>
  )
}

function ReportPanel({
  tab,
  tabs,
  today,
  search,
  onSearch,
}: {
  tab: ReportTab
  tabs: ReportTab[]
  today: string
  search: ReportSearch
  onSearch: (patch: Partial<ReportSearch>) => void
}) {
  const me = useMe()
  const r = resolveReport({ ...search, tab }, me, today, tabs)
  const { data: scope } = useSuspenseQuery(teamScopeQuery)
  // a filter change keeps the current result (dimmed) until the next one is ready
  const deferred = useDeferredParams(r)
  const { data: res } = useSuspenseQuery(reportQuery(deferred.params))
  const link = me.isManager
  return (
    <>
      <Filters>
        {tab === "timesheet" ? (
          <>
            {me.isManager ? (
              <PersonPicker
                scope={scope}
                value={r.userId}
                meId={me.id}
                onChange={(user) => onSearch({ user: user === me.id ? undefined : user })}
              />
            ) : null}
            <MonthNav month={r.month} today={today} onChange={(month) => onSearch({ month })} />
          </>
        ) : tab === "balances" ? (
          <>
            <YearMonthPicker
              year={r.balances.year}
              month={r.balances.month}
              onChange={(v) =>
                onSearch(
                  v.month
                    ? { month: `${v.year}-${String(v.month).padStart(2, "0")}`, whole: undefined, year: undefined }
                    : { whole: true, year: v.year },
                )
              }
            />
            <TeamFilter scope={scope} value={search.team} onChange={(team) => onSearch({ team })} />
          </>
        ) : (
          <>
            <RangePicker from={r.range.from} to={r.range.to} today={today} onChange={(v) => onSearch(v)} />
            {me.isManager ? (
              <TeamFilter scope={scope} value={search.team} onChange={(team) => onSearch({ team })} />
            ) : null}
          </>
        )}
      </Filters>
      <PeriodContent className={cn("transition-opacity duration-150", deferred.stale && "opacity-60")}>
        {res.tab === "timesheet" ? <TimesheetPreview d={res.data} today={today} /> : null}
        {res.tab === "balances" ? <BalancesPreview d={res.data} link={link} /> : null}
        {res.tab === "absences" ? <AbsencesPreview d={res.data} link={link} /> : null}
        {res.tab === "projects" ? (
          <ProjectsPreview
            d={res.data}
            projectId={search.project}
            onProject={(project) => onSearch({ project })}
            link={link}
          />
        ) : null}
        {res.tab === "compliance" ? <CompliancePreview d={res.data} /> : null}
        {res.tab === "entries" ? <EntriesPreview rows={res.data} /> : null}
      </PeriodContent>
    </>
  )
}
