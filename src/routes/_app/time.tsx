import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Page, PageHeader } from "@/components/app/page"
import { liveClockQuery } from "@/features/clock/use-clock"
import { periodQuery } from "@/features/time/api"
import { todayIn } from "@/features/time/lib"
import { periodParams } from "@/features/time/period"
import { TimeView, TimeViewSkeleton } from "@/features/time/time-view"
import { useT } from "@/lib/i18n"

const search = z.object({
  view: z.enum(["week", "month"]).optional().catch(undefined),
  date: z.iso.date().optional().catch(undefined),
  add: z.coerce.boolean().optional().catch(undefined),
  deleted: z.coerce.boolean().optional().catch(undefined),
  fix: z.enum(["project"]).optional().catch(undefined),
})

export const Route = createFileRoute("/_app/time")({
  staticData: { titleKey: "nav.time" },
  validateSearch: search,
  loaderDeps: ({ search: s }) => ({ view: s.view, date: s.date, deleted: s.deleted }),
  loader: ({ context: { queryClient: qc, me }, deps }) =>
    Promise.all([
      qc.ensureQueryData(periodQuery(periodParams(null, deps, todayIn(me.timezone)))),
      qc.ensureQueryData(liveClockQuery()),
    ]),
  pendingComponent: Pending,
  component: TimePage,
})

function Pending() {
  const t = useT()
  return (
    <Page>
      <PageHeader title={t("time.title")} />
      <TimeViewSkeleton />
    </Page>
  )
}

function TimePage() {
  const t = useT()
  const s = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <Page>
      <PageHeader title={t("time.title")} />
      <TimeView search={s} onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })} />
    </Page>
  )
}
