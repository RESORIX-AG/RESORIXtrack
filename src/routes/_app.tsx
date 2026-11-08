import { createFileRoute, redirect } from "@tanstack/react-router"
import { AppShell } from "@/components/app/app-shell"
import { liveClockQuery } from "@/features/clock/use-clock"
import { titleHead } from "@/lib/page-title"

/** Everything behind sign-in. Unauthenticated visitors go to /login (or /setup on a fresh install). */
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context, location }) => {
    const b = context.bootstrap
    if (!b.me) {
      if (!b.company.setupComplete) throw redirect({ to: "/setup" })
      throw redirect({ to: "/login", search: location.href !== "/" ? { next: location.href } : {} })
    }
    // two-factor setup is required first: the server answers nothing else
    if (b.me.mfaDue && location.pathname !== "/profile") throw redirect({ to: "/profile", hash: "mfa" })
    return { me: b.me }
  },
  // the top bar clock is on every page: render it on the server instead of a skeleton
  loader: ({ context }) =>
    context.bootstrap.me?.mfaDue ? undefined : context.queryClient.prefetchQuery(liveClockQuery()),
  head: ({ matches, match }) => titleHead(match.context.bootstrap.locale, matches),
  component: AppShell,
})
