import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportsPage } from "@/features/reports/reports-page"
import { REPORT_TABS, reportQuery, resolveReport, tabsFor } from "@/features/reports/search"
import { teamScopeQuery } from "@/features/team/api"
import { dayOf } from "@/lib/format"
import { isPeriodStep } from "@/lib/period-transition"

const id = z.coerce.number().int().positive().optional().catch(undefined)
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined)

export const Route = createFileRoute("/_app/reports")({
  staticData: { titleKey: "nav.reports" },
  validateSearch: z.object({
    tab: z.enum(REPORT_TABS).optional().catch(undefined),
    user: id,
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
    year: z.coerce.number().int().min(1990).max(2100).optional().catch(undefined),
    whole: z.coerce.boolean().optional().catch(undefined),
    from: day,
    to: day,
    team: id,
    project: id,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps, cause, location }) => {
    const me = context.me
    const r = resolveReport(
      deps,
      me,
      dayOf(new Date(), me.timezone),
      tabsFor(me, context.bootstrap.company.projectMode !== "off"),
    )
    const report = context.queryClient.prefetchQuery(reportQuery(r))
    await context.queryClient.ensureQueryData(teamScopeQuery)
    // on entry and for a month step the report is awaited; other filter changes commit at once and the
    // page keeps the current result until the next one is ready
    if (cause !== "stay" || isPeriodStep(location)) await report
  },
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </Page>
  ),
  component: ReportsRoute,
})

function ReportsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ReportsPage
      search={search}
      onSearch={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })}
    />
  )
}
