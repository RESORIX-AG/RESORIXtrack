/** Report tabs and their URL parameters, shared by the route (search validation, loader) and the page. */
import { queryOptions } from "@tanstack/react-query"
import { monthRange } from "@/lib/format"
import type { Me } from "@/lib/session"
import {
  fetchAbsencesReport,
  fetchBalancesReport,
  fetchComplianceReport,
  fetchProjectHours,
  fetchRawEntries,
  fetchTimesheet,
} from "./api"

export const REPORT_TABS = ["timesheet", "balances", "absences", "projects", "compliance", "entries"] as const
export type ReportTab = (typeof REPORT_TABS)[number]

export interface ReportSearch {
  tab?: ReportTab
  user?: number
  month?: string
  year?: number
  whole?: boolean
  from?: string
  to?: string
  team?: number
  project?: number
}

export function tabsFor(me: Me, projectsOn: boolean): ReportTab[] {
  if (me.isManager) return REPORT_TABS.filter((t) => t !== "projects" || projectsOn)
  return projectsOn ? ["timesheet", "projects"] : ["timesheet"]
}

/** Resolved parameters of the active tab (defaults: this month, oneself). */
export function resolveReport(search: ReportSearch, me: Me, today: string, tabs: ReportTab[]) {
  const tab = search.tab && tabs.includes(search.tab) ? search.tab : "timesheet"
  const month = search.month ?? today.slice(0, 7)
  const range =
    search.from && search.to && search.from <= search.to
      ? { from: search.from, to: search.to }
      : monthRange(today.slice(0, 7))
  const teamId = me.isManager ? (search.team ?? null) : null
  const userId = me.isManager ? (search.user ?? me.id) : me.id
  return {
    tab,
    month,
    range,
    teamId,
    userId,
    timesheet: { userId, year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) },
    balances: {
      year: search.year ?? Number(month.slice(0, 4)),
      month: search.whole ? null : Number(month.slice(5, 7)),
      teamId,
    },
    range_: { ...range, teamId, userId: me.isManager ? null : me.id },
  }
}

type ResolvedReport = ReturnType<typeof resolveReport>

/**
 * Query of the active tab. The result carries its tab, so a kept previous result (placeholder while the
 * next one loads) is always rendered by the preview it belongs to.
 */
export function reportQuery(r: ResolvedReport) {
  const params = r.tab === "timesheet" ? r.timesheet : r.tab === "balances" ? r.balances : r.range_
  return queryOptions({ queryKey: ["reports", "preview", r.tab, params], queryFn: () => fetchReport(r) })
}

async function fetchReport(r: ResolvedReport) {
  if (r.tab === "timesheet") return { tab: "timesheet" as const, data: await fetchTimesheet({ data: r.timesheet }) }
  if (r.tab === "balances") return { tab: "balances" as const, data: await fetchBalancesReport({ data: r.balances }) }
  if (r.tab === "absences") return { tab: "absences" as const, data: await fetchAbsencesReport({ data: r.range_ }) }
  if (r.tab === "projects") return { tab: "projects" as const, data: await fetchProjectHours({ data: r.range_ }) }
  if (r.tab === "compliance")
    return { tab: "compliance" as const, data: await fetchComplianceReport({ data: r.range_ }) }
  return { tab: "entries" as const, data: await fetchRawEntries({ data: r.range_ }) }
}
