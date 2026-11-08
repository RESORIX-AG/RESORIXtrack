/**
 * Navigation model shared by the desktop sidebar and the mobile tab bar. Visibility follows the
 * permission model (docs/security.md): things a role can never use are hidden, not disabled.
 */
import {
  BarChart3,
  CalendarCog,
  CalendarDays,
  Clock,
  DatabaseBackup,
  Flag,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  Settings,
  TreePalm,
  UserCog,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react"
import type { Bootstrap, Me } from "@/lib/session"

export interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
  badge?: number
  /** Short label for the mobile tab bar. */
  tabKey?: string
  /** Active also for nested paths (e.g. /team/member/3 for /team). */
  exact?: boolean
}
export interface NavGroup {
  labelKey?: string
  items: NavItem[]
}

export function buildNav(me: Me, b: Bootstrap): NavGroup[] {
  const groups: NavGroup[] = [
    {
      items: [
        { to: "/", labelKey: "nav.dashboard", tabKey: "nav.tab.dashboard", icon: LayoutDashboard, exact: true },
        { to: "/time", labelKey: "nav.time", tabKey: "nav.tab.time", icon: Clock },
        { to: "/absences", labelKey: "nav.absences", tabKey: "nav.tab.absences", icon: TreePalm },
        { to: "/holidays", labelKey: "nav.public_holidays", icon: Flag },
        { to: "/account", labelKey: "nav.account", tabKey: "nav.tab.account", icon: Wallet },
        { to: "/reports", labelKey: "nav.reports", icon: BarChart3 },
        ...(!me.isManager && me.teamId ? [{ to: "/calendar", labelKey: "nav.team_calendar", icon: CalendarDays }] : []),
      ],
    },
  ]
  const team: NavItem[] = []
  if (me.isManager) {
    team.push({ to: "/team", labelKey: "nav.team", tabKey: "nav.tab.team", icon: UsersRound, exact: true })
    team.push({ to: "/team/approvals", labelKey: "nav.approvals", icon: Inbox, badge: b.counts.pendingApprovals })
    team.push({ to: "/team/signoff", labelKey: "nav.signoff", icon: Lock })
  } else if (me.isAdmin && b.counts.pendingApprovals > 0) {
    // administrators are the approvers of last resort (nobody else could decide)
    team.push({ to: "/team/approvals", labelKey: "nav.approvals", icon: Inbox, badge: b.counts.pendingApprovals })
  }
  if (me.canProjects && b.company.projectMode !== "off") {
    team.push({ to: "/team/projects", labelKey: "nav.projects", icon: FolderKanban })
  }
  if (team.length) groups.push({ labelKey: "nav.team_section", items: team })
  if (me.isAdmin) {
    groups.push({
      labelKey: "nav.admin_section",
      items: [
        { to: "/admin/users", labelKey: "nav.users", icon: UserCog },
        { to: "/admin/teams", labelKey: "nav.teams", icon: Users },
        { to: "/admin/holidays", labelKey: "nav.holidays", icon: CalendarCog },
        { to: "/admin/settings", labelKey: "nav.settings", icon: Settings },
        { to: "/admin/backups", labelKey: "nav.backups", icon: DatabaseBackup },
      ],
    })
  }
  return groups
}

/** The four most-used destinations for the mobile tab bar (the rest lives under "More"). */
export function mobileTabs(me: Me, b: Bootstrap): NavItem[] {
  const all = buildNav(me, b).flatMap((g) => g.items)
  const pick = (to: string) => all.find((i) => i.to === to)
  return [pick("/"), pick("/time"), pick("/absences"), me.isManager ? pick("/team") : pick("/account")].filter(
    (x): x is NavItem => Boolean(x),
  )
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.to
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}
