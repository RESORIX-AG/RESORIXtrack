import { useSuspenseQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ShieldCheck, UserPlus } from "lucide-react"
import { useState } from "react"
import { Page, PageHeader } from "@/components/app/page"
import { RelativeTime } from "@/components/app/relative-time"
import { Segmented } from "@/components/app/segmented"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { PersonAvatar } from "@/components/app/user-menu"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isOneOf } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import type { UserRow } from "@/server/services/users"
import { userRefsQuery, usersQuery } from "../api/users"
import { USER_ROLE_FILTERS, USER_STATUS_FILTERS } from "../search"
import { FilterSelect } from "../ui"
import { CreateUserSheet } from "./create-user"

export type UsersSearch = {
  status?: (typeof USER_STATUS_FILTERS)[number]
  team?: string
  role?: (typeof USER_ROLE_FILTERS)[number]
}

const col = tableHelper<UserRow>()

export function RoleBadges({ row }: { row: Pick<UserRow, "role" | "capabilities" | "isLead" | "isDeputy"> }) {
  const { t } = useI18n()
  const badges = [
    row.role === "admin" ? (
      <StatusBadge key="a" tone="brand">
        {t("admin.roles.admin")}
      </StatusBadge>
    ) : null,
    row.capabilities.includes("hr") ? (
      <StatusBadge key="h" tone="positive">
        {t("admin.roles.hr")}
      </StatusBadge>
    ) : null,
    row.isLead ? (
      <StatusBadge key="l" tone="info">
        {t(row.isDeputy ? "admin.teams.role_deputy" : "admin.roles.lead")}
      </StatusBadge>
    ) : null,
    row.capabilities.includes("projects") ? <StatusBadge key="p">{t("admin.roles.projects")}</StatusBadge> : null,
  ].filter(Boolean)
  return badges.length ? (
    <span className="flex flex-wrap gap-1">{badges}</span>
  ) : (
    <span className="text-muted-foreground">{t("admin.roles.employee")}</span>
  )
}

export function AccountStatus({ row }: { row: Pick<UserRow, "isActive" | "invitePending" | "anonymized"> }) {
  const { t } = useI18n()
  if (row.anonymized) return <StatusBadge>{t("admin.status.anonymized")}</StatusBadge>
  if (!row.isActive)
    return (
      <StatusBadge tone="negative" icon="cancelled">
        {t("admin.status.inactive")}
      </StatusBadge>
    )
  if (row.invitePending)
    return (
      <StatusBadge tone="warning" icon="pending">
        {t("admin.status.invited")}
      </StatusBadge>
    )
  return (
    <StatusBadge tone="positive" icon="approved">
      {t("admin.status.active")}
    </StatusBadge>
  )
}

export function UsersPage({ search, onSearch }: { search: UsersSearch; onSearch: (s: UsersSearch) => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const status = search.status ?? "active"
  const { data } = useSuspenseQuery(usersQuery(status))
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  const [creating, setCreating] = useState(false)

  const rows = data.filter((u) => {
    if (search.team === "none" && u.teamId != null) return false
    if (search.team && search.team !== "none" && String(u.teamId) !== search.team) return false
    if (search.role === "admin" && u.role !== "admin") return false
    if ((search.role === "hr" || search.role === "projects") && !u.capabilities.includes(search.role)) return false
    if (search.role === "lead" && !u.isLead) return false
    return true
  })

  const columns = [
    // the search finds a person by name or email
    col.accessor((r) => `${r.name} ${r.email}`, {
      id: "name",
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={c.row.original.name} className="size-8 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{c.row.original.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{c.row.original.email}</span>
          </span>
        </span>
      ),
    }),
    col.accessor((r) => r.teamName ?? "", {
      id: "team",
      header: () => t("common.team"),
      meta: { mobileLabel: t("common.team") },
      cell: (c) =>
        c.row.original.teamName ? (
          <span className="flex items-center gap-2">
            <ColorDot color={c.row.original.teamColor ?? "transparent"} />
            {c.row.original.teamName}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    }),
    col.accessor((r) => `${r.role} ${r.capabilities.join(" ")} ${r.isLead ? "lead" : ""}`, {
      id: "role",
      header: () => t("common.role"),
      enableSorting: false,
      meta: { mobileLabel: t("common.role") },
      cell: (c) => <RoleBadges row={c.row.original} />,
    }),
    col.accessor((r) => (r.anonymized ? 3 : !r.isActive ? 2 : r.invitePending ? 1 : 0), {
      id: "status",
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) => (
        <span className="flex items-center gap-1.5">
          <AccountStatus row={c.row.original} />
          {c.row.original.mfaEnabled ? (
            <Tooltip>
              <TooltipTrigger
                render={<ShieldCheck className="size-4 text-positive" aria-label={t("admin.status.mfa")} />}
              />
              <TooltipContent>{t("admin.status.mfa")}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      ),
    }),
    col.accessor((r) => r.lastLoginAt ?? "", {
      id: "lastLogin",
      header: () => t("admin.users.last_login"),
      meta: { hideOnMobile: true, className: "text-muted-foreground whitespace-nowrap" },
      cell: (c) =>
        c.row.original.lastLoginAt ? <RelativeTime at={c.row.original.lastLoginAt} /> : t("admin.users.never"),
    }),
  ]

  return (
    <Page>
      <PageHeader
        title={t("admin.users.title")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus data-icon="inline-start" />
            {t("admin.users.add")}
          </Button>
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => String(r.id)}
        search
        searchPlaceholder={t("admin.users.search")}
        initialSorting={[{ id: "name", desc: false }]}
        onRowClick={(r) => navigate({ to: "/admin/users/$userId", params: { userId: r.id } })}
        empty={t("admin.users.empty")}
        caption={t("admin.users.title")}
        toolbar={
          <>
            <FilterSelect
              searchable
              label={t("common.team")}
              value={search.team ?? ""}
              onChange={(v) => onSearch({ ...search, team: v || undefined })}
              options={[
                { value: "", label: t("admin.users.all_teams") },
                { value: "none", label: t("admin.users.no_team") },
                ...refs.teams.map((tm) => ({ value: String(tm.id), label: tm.name })),
              ]}
            />
            <FilterSelect
              label={t("common.role")}
              value={search.role ?? ""}
              onChange={(v) => onSearch({ ...search, role: isOneOf(USER_ROLE_FILTERS, v) ? v : undefined })}
              options={[
                { value: "", label: t("admin.users.all_roles") },
                { value: "admin", label: t("admin.roles.admin") },
                { value: "hr", label: t("admin.roles.hr") },
                { value: "lead", label: t("admin.roles.lead") },
                { value: "projects", label: t("admin.roles.projects") },
              ]}
            />
            <Segmented
              value={status}
              onValueChange={(v) => onSearch({ ...search, status: v === "active" ? undefined : v })}
              aria-label={t("common.status")}
              options={USER_STATUS_FILTERS.map((v) => ({
                value: v,
                label: v === "all" ? t("common.all") : t(`admin.status.${v}`),
              }))}
            />
          </>
        }
      />
      <CreateUserSheet open={creating} onOpenChange={setCreating} />
    </Page>
  )
}
