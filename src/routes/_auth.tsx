import { createFileRoute, Outlet } from "@tanstack/react-router"
import { CompanyLogo, Wordmark } from "@/components/app/logo"
import { ThemeMenu } from "@/components/app/theme"
import { titleHead } from "@/lib/page-title"
import { useBootstrap } from "@/lib/session"

/** Signed-out pages (sign in, password reset, invitation, first-run setup): one centred card on the hero gradient. */
export const Route = createFileRoute("/_auth")({
  head: ({ matches, match }) => titleHead(match.context.bootstrap.locale, matches),
  component: AuthLayout,
})

function AuthLayout() {
  const b = useBootstrap()
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-hero">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <CompanyLogo />
        </div>
        <ThemeMenu />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <Wordmark className="text-xl" />
            <p className="mt-1 text-sm text-muted-foreground">{b.company.name}</p>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
