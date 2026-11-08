/**
 * Home page: greeting, the clock card, today/week/balance/vacation, this week's chart, upcoming absences,
 * labour-law hints and the missing-project reminder (each only when there is something to show).
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Inbox } from "lucide-react"
import { Page, PageHeader } from "@/components/app/page"
import { ButtonLink } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { GettingStartedCard } from "@/features/admin/getting-started"
import { useClock } from "@/features/clock/use-clock"
import { timeOverviewQuery } from "@/features/time/api"
import { wallClock } from "@/features/time/lib"
import { fmtDayLong } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useBootstrap, useMe } from "@/lib/session"
import { HeroClock } from "./hero-clock"
import { ComplianceHints, ProjectReminder, StatTiles, UpcomingCard, WeekCard } from "./sections"

// owned by the team package (route may not exist yet in every build)
const APPROVALS: string = "/team/approvals"

function greetingKey(hour: number): string {
  return hour < 11 ? "dashboard.morning" : hour < 17 ? "dashboard.afternoon" : "dashboard.evening"
}

export function Dashboard() {
  const { t, intl } = useI18n()
  const me = useMe()
  const b = useBootstrap()
  const overview = useSuspenseQuery(timeOverviewQuery()).data
  const clock = useClock()
  // the hour comes from the server's clock (same text on the server and in the browser)
  const hour = Number(wallClock(overview.clock.serverTime, me.timezone).time.slice(0, 2))
  const first = me.name.split(" ")[0]
  return (
    <Page>
      <PageHeader
        title={`${t(greetingKey(hour))}, ${first}`}
        description={fmtDayLong(overview.today.date, intl)}
        actions={
          b.counts.pendingApprovals > 0 && (me.isManager || me.isAdmin) ? (
            <ButtonLink variant="outline" render={<Link to={APPROVALS} />}>
              <Inbox data-icon="inline-start" />
              {t("dashboard.pending_approvals", { count: b.counts.pendingApprovals })}
            </ButtonLink>
          ) : null
        }
      />
      <GettingStartedCard />
      {/* wide screens: clock and figures side by side */}
      <div className="grid gap-6 2xl:grid-cols-2 2xl:gap-4">
        <HeroClock clock={clock} today={overview.today} />
        <StatTiles overview={overview} clock={clock} className="2xl:grid-cols-2" />
      </div>
      <ComplianceHints today={overview.today.date} />
      <ProjectReminder day={overview.projectMissingDay} />
      <div className="grid gap-4 lg:grid-cols-3">
        <WeekCard overview={overview} />
        <UpcomingCard userId={me.id} today={overview.today.date} />
      </div>
    </Page>
  )
}

export function DashboardSkeleton() {
  return (
    <Page>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-60 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </Page>
  )
}
