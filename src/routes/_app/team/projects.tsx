import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { Page } from "@/components/app/page"
import { Skeleton } from "@/components/ui/skeleton"
import { projectsQuery } from "@/features/projects/api"
import { teamScopeQuery } from "@/features/team/api"
import { ProjectsPage } from "@/features/team/projects-page"

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined)

export const Route = createFileRoute("/_app/team/projects")({
  staticData: { titleKey: "nav.projects" },
  validateSearch: z.object({
    from: day,
    to: day,
    project: z.coerce.number().int().positive().optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => {
    if (!context.me.canProjects) throw redirect({ to: "/" })
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectsQuery(true)),
      context.queryClient.ensureQueryData(teamScopeQuery),
    ]),
  pendingComponent: () => (
    <Page>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-96 rounded-xl" />
    </Page>
  ),
  component: ProjectsRoute,
})

function ProjectsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ProjectsPage
      search={search}
      onSearch={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false })}
    />
  )
}
