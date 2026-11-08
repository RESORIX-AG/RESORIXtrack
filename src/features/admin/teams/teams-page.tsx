import { useSuspenseQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { Page, PageHeader } from "@/components/app/page"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useI18n } from "@/lib/i18n"
import type { TeamRow } from "@/server/services/teams"
import { teamsQuery } from "../api/teams"
import { userRefsQuery } from "../api/users"
import { todayLocal } from "../lib"
import { fmtPeriod } from "./periods"
import { TeamSheet } from "./team-sheet"

const col = tableHelper<TeamRow>()

export function TeamsPage() {
  const { t, intl } = useI18n()
  const { data } = useSuspenseQuery(teamsQuery)
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  const companyCalendar = refs.calendars.find((c) => c.isDefault)
  const [editing, setEditing] = useState<number | "new" | null>(null)
  const columns = [
    col.accessor("name", {
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => (
        <span className="flex items-center gap-2.5 font-medium">
          <ColorDot color={c.row.original.color} className="size-3" />
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor(
      (r) =>
        r.leads
          .filter((l) => l.role === "lead" && l.active)
          .map((l) => l.name)
          .join(", "),
      {
        id: "leads",
        header: () => t("admin.teams.leads"),
        meta: { mobileLabel: t("admin.teams.leads") },
        cell: (c) =>
          c.getValue() || (
            <StatusBadge tone="warning" icon="warning">
              {t("admin.teams.no_lead")}
            </StatusBadge>
          ),
      },
    ),
    col.accessor(
      (r) =>
        r.leads
          .filter((l) => l.role === "deputy")
          .map((l) => l.name)
          .join(", "),
      {
        id: "deputies",
        header: () => t("admin.teams.deputies"),
        meta: { mobileLabel: t("admin.teams.deputies"), hideOnMobile: true },
        cell: (c) => {
          const deps = c.row.original.leads.filter(
            (l) => l.role === "deputy" && (l.active || (l.validTo ?? "9999") >= todayLocal()),
          )
          if (!deps.length) return <span className="text-muted-foreground">–</span>
          return (
            <span className="flex flex-col">
              {deps.map((d) => (
                <span key={d.id} className="truncate">
                  {d.name}{" "}
                  {d.validFrom || d.validTo ? (
                    <span className="text-xs text-muted-foreground">{fmtPeriod(d.validFrom, d.validTo, intl, t)}</span>
                  ) : null}
                </span>
              ))}
            </span>
          )
        },
      },
    ),
    col.accessor((r) => r.members.length, {
      id: "members",
      header: () => t("admin.teams.members"),
      meta: { numeric: true, mobileLabel: t("admin.teams.members") },
    }),
    col.accessor((r) => r.calendarName ?? companyCalendar?.name ?? "", {
      id: "calendar",
      header: () => t("admin.teams.calendar"),
      meta: { hideOnMobile: true },
      cell: (c) => (
        <span className="flex items-center gap-2">
          {c.getValue()}
          {companyCalendar && (c.row.original.holidayCalendarId ?? companyCalendar.id) === companyCalendar.id ? (
            <StatusBadge tone="brand">{t("admin.holidays.default")}</StatusBadge>
          ) : null}
        </span>
      ),
    }),
  ]
  return (
    <Page>
      <PageHeader
        title={t("admin.teams.title")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            {t("admin.teams.new")}
          </Button>
        }
      />
      {data.length ? (
        <DataTable
          data={data}
          columns={columns}
          getRowId={(r) => String(r.id)}
          search={data.length > 8}
          initialSorting={[{ id: "name", desc: false }]}
          onRowClick={(r) => setEditing(r.id)}
          caption={t("admin.teams.title")}
        />
      ) : (
        <Empty className="rounded-xl border bg-card">
          <EmptyHeader>
            <EmptyTitle>{t("admin.teams.empty")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus data-icon="inline-start" />
              {t("admin.teams.new")}
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {editing != null ? (
        <TeamSheet
          teamId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(id) => setEditing(id)}
        />
      ) : null}
    </Page>
  )
}
