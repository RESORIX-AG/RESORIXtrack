/**
 * Authenticated application frame.
 *
 * Desktop (≥ md): collapsible sidebar + top bar (page title, clock control, notifications, theme, account).
 * Mobile: compact top bar, sticky clock bar and a bottom tab bar with the four most-used destinations;
 * "More" opens the full navigation as a sheet. Focus moves to the page heading after every navigation.
 */
import { Link, Outlet, useMatches, useRouter, useRouterState } from "@tanstack/react-router"
import { ChevronRight, Menu } from "lucide-react"
import { useEffect, useEffectEvent } from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { ClockControl } from "@/features/clock/clock-control"
import { NotificationsBell } from "@/features/notifications/bell"
import { MfaBanner } from "@/features/profile/mfa-banner"
import { useT } from "@/lib/i18n"
import { useBootstrap, useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { CommandPalette } from "./command-palette"
import { CompanyLogo, Wordmark } from "./logo"
import { buildNav, isActive, mobileTabs } from "./nav"
import { ThemeMenu } from "./theme"
import { PersonAvatar, UserMenu } from "./user-menu"

function usePageTitleKey(): string | undefined {
  const matches = useMatches()
  for (let i = matches.length - 1; i >= 0; i--) {
    const key = matches[i].staticData?.titleKey
    if (key) return key
  }
  return undefined
}

function AppSidebar() {
  const t = useT()
  const me = useMe()
  const b = useBootstrap()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { setOpenMobile, isMobile } = useSidebar()
  const close = () => isMobile && setOpenMobile(false)
  return (
    <Sidebar collapsible="offcanvas" aria-label={t("nav.main")}>
      <SidebarHeader className="gap-2 px-4 pt-5 pb-3">
        <Link
          to="/"
          onClick={close}
          className="flex flex-col items-start gap-2 rounded-md"
          aria-label={t("nav.dashboard")}
        >
          <CompanyLogo />
          <Wordmark />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {buildNav(me, b).map((group, gi) => (
          <SidebarGroup key={group.labelKey ?? gi}>
            {group.labelKey ? <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(pathname, item)
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={active}
                        className="h-9 font-medium"
                        render={<Link to={item.to} onClick={close} aria-current={active ? "page" : undefined} />}
                      >
                        <item.icon />
                        <span>{t(item.labelKey)}</span>
                      </SidebarMenuButton>
                      {item.badge ? (
                        <SidebarMenuBadge className="bg-primary text-primary-foreground tabular">
                          {item.badge}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              isActive={pathname === "/profile"}
              render={<Link to="/profile" onClick={close} title={t("nav.profile_hint")} />}
            >
              <PersonAvatar name={me.name} className="size-8" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{me.name}</span>
                <span className="truncate text-xs text-muted-foreground">{t("nav.profile")}</span>
              </span>
              <ChevronRight className="opacity-50" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function MobileTabBar() {
  const t = useT()
  const me = useMe()
  const b = useBootstrap()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { setOpenMobile, openMobile } = useSidebar()
  const tabs = mobileTabs(me, b)
  const anyActive = tabs.some((tab) => isActive(pathname, tab))
  const itemCls =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150"
  return (
    <nav
      aria-label={t("nav.main")}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-safe backdrop-blur md:hidden"
    >
      <div className="flex">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? "page" : undefined}
              className={cn(itemCls, active ? "text-primary" : "text-muted-foreground")}
            >
              <span className="relative">
                <tab.icon className="size-5" />
                {tab.badge ? (
                  <span className="absolute -top-1 -right-2 size-2 rounded-full bg-primary" aria-hidden />
                ) : null}
              </span>
              <span className="max-w-full truncate px-1">{t(tab.tabKey ?? tab.labelKey)}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          aria-expanded={openMobile}
          className={cn(itemCls, !anyActive ? "text-primary" : "text-muted-foreground")}
        >
          <Menu className="size-5" />
          <span className="max-w-full truncate px-1">{t("nav.more")}</span>
        </button>
      </div>
    </nav>
  )
}

/** After client-side navigation, move focus to the new page's heading (keyboard + screen readers). */
function useFocusHeadingOnNavigate() {
  const router = useRouter()
  const onResolved = useEffectEvent((e: { fromLocation?: { pathname: string }; toLocation: { pathname: string } }) => {
    if (!e.fromLocation || e.fromLocation.pathname === e.toLocation.pathname) return
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("[data-page-heading]")?.focus({ preventScroll: true }),
    )
  })
  useEffect(() => router.subscribe("onResolved", onResolved), [router])
}

export function AppShell() {
  const t = useT()
  const titleKey = usePageTitleKey()
  const b = useBootstrap()
  // until two-factor is set up only the profile answers: no clock, search or notifications
  const ready = !b.me?.mfaDue
  useFocusHeadingOnNavigate()
  return (
    <SidebarProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t("nav.skip_to_content")}
      </a>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:h-16 md:px-6">
          <SidebarTrigger className="hidden md:inline-flex" aria-label={t("nav.toggle_sidebar")} />
          <Link to="/" className="flex items-center md:hidden" aria-label={t("nav.dashboard")}>
            <Wordmark />
          </Link>
          <p className="hidden truncate text-base font-semibold md:block">{titleKey ? t(titleKey) : b.company.name}</p>
          <div className="ml-auto flex items-center gap-2">
            {ready ? <CommandPalette /> : null}
            {ready ? (
              <div className="hidden md:block">
                <ClockControl variant="topbar" />
              </div>
            ) : null}
            <div className="flex items-center gap-1">
              {ready ? <NotificationsBell /> : null}
              <ThemeMenu />
              <UserMenu />
            </div>
          </div>
        </header>
        <main id="main" className="flex-1 pb-36 md:pb-0">
          <MfaBanner />
          <Outlet />
        </main>
        {ready ? (
          <div className="fixed inset-x-0 bottom-[calc(3.5rem+max(var(--safe-bottom),0.5rem))] z-30 px-3 pb-2 md:hidden">
            <ClockControl variant="bar" />
          </div>
        ) : null}
        <MobileTabBar />
      </SidebarInset>
    </SidebarProvider>
  )
}
