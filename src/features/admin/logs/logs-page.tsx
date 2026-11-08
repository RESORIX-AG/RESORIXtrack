import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query"
import { DatabaseBackup, Download, Info, Lock, Trash2 } from "lucide-react"
import { useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm"
import { Page, PageHeader, Section } from "@/components/app/page"
import { RelativeTime } from "@/components/app/relative-time"
import { Segmented } from "@/components/app/segmented"
import { StatusBadge } from "@/components/app/status-badge"
import { PanelSkeleton, TabPanel } from "@/components/app/tab-panel"
import { TabStrip } from "@/components/app/tab-strip"
import { DataTable, type InfiniteRows } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { Button, ButtonLink } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDeferredParams } from "@/hooks/use-deferred-params"
import { fmtDateTime, fmtDay } from "@/lib/format"
import { isOneOf } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { AuditItem, LoginItem } from "@/server/services/admin-logs"
import type { AdminApiKey } from "@/server/services/api-keys"
import type { BackupInfo } from "@/server/services/backups"
import { API_KEY_STATUSES, type ApiKeyFilters, allApiKeysQuery, revokeApiKeyAdminFn } from "../api/api-keys"
import {
  type AuditFilters,
  auditQuery,
  backupsQuery,
  createBackupFn,
  deleteBackupFn,
  type LoginFilters,
  loginsQuery,
} from "../api/logs"
import { userRefsQuery } from "../api/users"
import { LOG_TABS, type LogTab } from "../search"
import { FilterSelect, ServerPager, useAction } from "../ui"
import { AuditDetail } from "./audit-detail"
import { ChangeList } from "./change-list"

function useDateTime() {
  const { intl } = useI18n()
  const me = useMe()
  return (at: string) => fmtDateTime(at, { intl, tz: me.timezone, hour12: me.timeFormat === "12h" })
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function LogsPage({
  tab,
  onTab,
  audit,
  onAudit,
  logins,
  onLogins,
  keys,
  onKeys,
}: {
  tab: LogTab
  onTab: (t: LogTab) => void
  audit: AuditFilters
  onAudit: (f: AuditFilters) => void
  logins: LoginFilters
  onLogins: (f: LoginFilters) => void
  keys: ApiKeyFilters
  onKeys: (f: ApiKeyFilters) => void
}) {
  const { t } = useI18n()
  return (
    <Page>
      <PageHeader title={t("admin.backups.page_title")} />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (isOneOf(LOG_TABS, v)) onTab(v)
        }}
        className="gap-6"
      >
        <TabStrip>
          <TabsList variant="line">
            {LOG_TABS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`admin.backups.tabs.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </TabStrip>
        <TabPanel value="backups" active={tab === "backups"} fallback={<PanelSkeleton />}>
          <BackupsTab />
        </TabPanel>
        <TabPanel value="audit" active={tab === "audit"} fallback={<PanelSkeleton />}>
          <AuditTab filters={audit} onFilters={onAudit} />
        </TabPanel>
        <TabPanel value="logins" active={tab === "logins"} fallback={<PanelSkeleton />}>
          <LoginsTab filters={logins} onFilters={onLogins} />
        </TabPanel>
        <TabPanel value="keys" active={tab === "keys"} fallback={<PanelSkeleton />}>
          <KeysTab filters={keys} onFilters={onKeys} />
        </TabPanel>
      </Tabs>
    </Page>
  )
}

const bcol = tableHelper<BackupInfo>()

function BackupsTab() {
  const { t } = useI18n()
  const dt = useDateTime()
  const { data } = useSuspenseQuery(backupsQuery)
  const [deleting, setDeleting] = useState<string | null>(null)
  const create = useAction(() => createBackupFn({ data: { includeAttachments: true } }), {
    success: t("admin.backups.created"),
    invalidate: [["admin", "backups"]],
  })
  const remove = useAction((name: string) => deleteBackupFn({ data: { name } }), {
    success: t("admin.backups.deleted"),
    invalidate: [["admin", "backups"]],
  })
  const columns = [
    bcol.accessor("createdAt", {
      header: () => t("admin.backups.created_at"),
      meta: { primary: true, className: "whitespace-nowrap" },
      cell: (c) => dt(c.getValue()),
    }),
    bcol.accessor("kind", {
      header: () => t("common.type"),
      meta: { mobileLabel: t("common.type") },
      cell: (c) => (
        <StatusBadge tone={c.getValue() === "manual" ? "brand" : "neutral"}>
          {t(`admin.backups.kinds.${c.getValue()}`)}
        </StatusBadge>
      ),
    }),
    bcol.accessor("name", {
      header: () => t("admin.backups.file"),
      meta: { hideOnMobile: true },
      cell: (c) => <span className="font-mono text-xs text-muted-foreground">{c.getValue()}</span>,
    }),
    bcol.accessor("size", {
      header: () => t("admin.backups.size"),
      meta: { numeric: true, mobileLabel: t("admin.backups.size") },
      cell: (c) => fmtSize(c.getValue()),
    }),
    bcol.display({
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      meta: { className: "w-24 text-right" },
      cell: (c) => (
        <span className="flex justify-end gap-1">
          <ButtonLink
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.download")}
            title={t("common.download")}
            href={`/api/admin/backups/${c.row.original.name}`}
            download
          >
            <Download />
          </ButtonLink>
          <Button
            intent="negative"
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.delete")}
            title={t("common.delete")}
            onClick={() => setDeleting(c.row.original.name)}
          >
            <Trash2 />
          </Button>
        </span>
      ),
    }),
  ]
  return (
    <Section
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Tooltip>
            <TooltipTrigger render={<span className="flex items-center gap-1.5" />}>
              <Lock className="size-4" />
              {t("admin.backups.encrypted")}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{t("admin.backups.encrypted_help")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<span className="flex items-center gap-1.5" />}>
              <Info className="size-4" />
              {t("admin.backups.restore")}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{t("admin.backups.restore_help")}</TooltipContent>
          </Tooltip>
        </span>
      }
      actions={
        <Button onClick={() => create.mutate(undefined)} disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : <DatabaseBackup data-icon="inline-start" />}
          {t("admin.backups.create")}
        </Button>
      }
    >
      <DataTable
        data={data}
        columns={columns}
        getRowId={(r) => r.name}
        empty={t("admin.backups.none")}
        caption={t("admin.backups.tabs.backups")}
      />
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("admin.backups.delete_title")}
        description={deleting ?? ""}
        confirmLabel={t("common.delete")}
        onConfirm={() => (deleting == null ? undefined : remove.mutateAsync(deleting))}
      />
    </Section>
  )
}

/** A cursor-paginated query as the DataTable's infinite rows. */
function infiniteRows(q: {
  data: { pages: { total: number | null }[] }
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
}): InfiniteRows {
  return {
    hasMore: q.hasNextPage,
    loading: q.isFetchingNextPage,
    onLoadMore: () => void q.fetchNextPage(),
    total: q.data.pages[0]?.total,
  }
}

const acol = tableHelper<AuditItem>()
const ENTITIES = [
  "user",
  "team_lead",
  "schedule",
  "entitlement",
  "project",
  "api_token",
  "holiday",
  "signoff",
  "time_entry",
  "absence",
  "adjustment",
  "attachment",
  "work_log",
]
const ACTIONS = [
  "create",
  "update",
  "delete",
  "restore",
  "approve",
  "reject",
  "cancel",
  "signoff",
  "reopen",
  "password_set",
  "mfa_reset",
  "passkeys_removed",
  "anonymize",
  "revoke",
]

function AuditTab({ filters, onFilters }: { filters: AuditFilters; onFilters: (f: AuditFilters) => void }) {
  const { t, has } = useI18n()
  const me = useMe()
  const dt = useDateTime()
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  const deferred = useDeferredParams(filters)
  const audit = useSuspenseInfiniteQuery(auditQuery(deferred.params))
  const [open, setOpen] = useState<AuditItem | null>(null)
  const set = (patch: Partial<AuditFilters>) => onFilters({ ...filters, ...patch })
  const entities = me.isHr ? ENTITIES : ENTITIES.slice(0, 7)
  const columns = [
    acol.accessor("at", {
      header: () => t("admin.audit.when"),
      enableSorting: false,
      meta: { className: "whitespace-nowrap", mobileLabel: t("admin.audit.when"), width: "12.5rem" },
      cell: (c) => dt(c.getValue()),
    }),
    acol.accessor((r) => r.subject ?? "", {
      id: "subject",
      header: () => t("admin.audit.person"),
      enableSorting: false,
      meta: { primary: true, width: "20%" },
      cell: (c) => c.getValue() || "–",
    }),
    acol.accessor("entity", {
      header: () => t("admin.audit.what"),
      enableSorting: false,
      meta: { mobileLabel: t("admin.audit.what"), width: "20%" },
      cell: (c) => (
        <span>
          {has(`admin.audit.entities.${c.getValue()}`) ? t(`admin.audit.entities.${c.getValue()}`) : c.getValue()}{" "}
          <span className="text-muted-foreground">
            {has(`admin.audit.actions.${c.row.original.action}`)
              ? t(`admin.audit.actions.${c.row.original.action}`)
              : c.row.original.action}
          </span>
        </span>
      ),
    }),
    acol.accessor((r) => r.actor ?? "", {
      id: "actor",
      header: () => t("admin.audit.by"),
      enableSorting: false,
      meta: { mobileLabel: t("admin.audit.by"), width: "16%" },
      cell: (c) => c.getValue() || <span className="text-muted-foreground">{t("admin.audit.system")}</span>,
    }),
    acol.display({
      id: "changes",
      header: () => t("admin.audit.changes"),
      meta: { hideOnMobile: true },
      cell: (c) => <ChangeList item={c.row.original} max={2} />,
    }),
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          value={filters.userId ? String(filters.userId) : null}
          onChange={(v) => set({ userId: v ? Number(v) : null })}
          allowClear={t("admin.audit.all_people")}
          placeholder={t("admin.audit.all_people")}
          className="w-56"
          options={refs.people.map((p) => ({ value: String(p.id), label: p.name, hint: p.email }))}
        />
        <FilterSelect
          label={t("admin.audit.what")}
          value={filters.entity ?? ""}
          onChange={(v) => set({ entity: v || null })}
          options={[
            { value: "", label: t("admin.audit.all_entities") },
            ...entities.map((e) => ({ value: e, label: t(`admin.audit.entities.${e}`) })),
          ]}
        />
        <FilterSelect
          label={t("admin.audit.action")}
          value={filters.action ?? ""}
          onChange={(v) => set({ action: v || null })}
          options={[
            { value: "", label: t("admin.audit.all_actions") },
            ...ACTIONS.map((a) => ({ value: a, label: t(`admin.audit.actions.${a}`) })),
          ]}
        />
        <DateRange from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
        {deferred.stale ? <Spinner className="text-muted-foreground" /> : null}
      </div>
      <DataTable
        data={audit.data.pages.flatMap((p) => p.items)}
        columns={columns}
        getRowId={(r) => String(r.id)}
        infinite={infiniteRows(audit)}
        onRowClick={setOpen}
        empty={t("admin.audit.none")}
        caption={t("admin.backups.tabs.audit")}
      />
      {open ? <AuditDetail item={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

function DateRange({
  from,
  to,
  onChange,
}: {
  from: string | null
  to: string | null
  onChange: (from: string | null, to: string | null) => void
}) {
  const { t } = useI18n()
  return (
    <span className="flex items-center gap-1.5">
      <DatePicker
        icon
        value={from ?? ""}
        max={to ?? undefined}
        onChange={(v) => onChange(v || null, to)}
        aria-label={t("common.from")}
        placeholder={t("common.from")}
        className="w-44"
      />
      <span className="text-muted-foreground">–</span>
      <DatePicker
        icon
        value={to ?? ""}
        min={from ?? undefined}
        onChange={(v) => onChange(from, v || null)}
        aria-label={t("common.to")}
        placeholder={t("common.to")}
        className="w-44"
      />
    </span>
  )
}

const lcol = tableHelper<LoginItem>()

function shortAgent(ua: string): string {
  const browser = ua.match(/(Edg|Firefox|Chrome|Safari)\/[\d.]+/)?.[1]?.replace("Edg", "Edge") ?? ""
  const os = ua.match(/(Windows|Mac OS X|iPhone|iPad|Android|Linux)/)?.[1]?.replace("Mac OS X", "macOS") ?? ""
  return [browser, os].filter(Boolean).join(" · ") || ua.slice(0, 40)
}

function LoginsTab({ filters, onFilters }: { filters: LoginFilters; onFilters: (f: LoginFilters) => void }) {
  const { t, has } = useI18n()
  const dt = useDateTime()
  const [q, setQ] = useState(filters.q ?? "")
  // the draft follows the URL when the search is reset elsewhere (switching tabs clears the filters)
  const [shownQ, setShownQ] = useState(filters.q)
  if (filters.q !== shownQ) {
    setShownQ(filters.q)
    setQ(filters.q ?? "")
  }
  const deferred = useDeferredParams(filters)
  const logins = useSuspenseInfiniteQuery(loginsQuery(deferred.params))
  const set = (patch: Partial<LoginFilters>) => onFilters({ ...filters, ...patch })
  const columns = [
    lcol.accessor("at", {
      header: () => t("admin.audit.when"),
      enableSorting: false,
      meta: { className: "whitespace-nowrap", mobileLabel: t("admin.audit.when"), width: "12.5rem" },
      cell: (c) => dt(c.getValue()),
    }),
    lcol.accessor("email", {
      header: () => t("admin.logins.account"),
      enableSorting: false,
      meta: { primary: true, width: "26%" },
      cell: (c) => (
        <span className="min-w-0">
          <span className="block truncate">{c.row.original.name ?? c.getValue()}</span>
          {c.row.original.name ? (
            <span className="block truncate text-xs text-muted-foreground">{c.getValue()}</span>
          ) : null}
        </span>
      ),
    }),
    lcol.accessor("success", {
      header: () => t("admin.logins.result"),
      enableSorting: false,
      meta: { mobileLabel: t("admin.logins.result"), width: "13rem" },
      cell: (c) => {
        const reason = c.row.original.reason
        const label = has(`admin.logins.reasons.${reason}`) ? t(`admin.logins.reasons.${reason}`) : reason
        return (
          <StatusBadge tone={c.getValue() ? "positive" : "negative"} icon={c.getValue() ? "approved" : "rejected"}>
            {label}
          </StatusBadge>
        )
      },
    }),
    lcol.accessor("ip", {
      header: () => t("admin.logins.ip"),
      enableSorting: false,
      meta: { mobileLabel: t("admin.logins.ip"), width: "11rem" },
      cell: (c) => <span className="font-mono text-xs break-all">{c.getValue() || "–"}</span>,
    }),
    lcol.accessor("userAgent", {
      header: () => t("admin.logins.device"),
      enableSorting: false,
      meta: { hideOnMobile: true, className: "text-muted-foreground" },
      cell: (c) => <span title={c.getValue()}>{c.getValue() ? shortAgent(c.getValue()) : "–"}</span>,
    }),
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            set({ q: q.trim() || null })
          }}
        >
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => set({ q: q.trim() || null })}
            placeholder={t("admin.logins.search")}
            aria-label={t("admin.logins.search")}
            className="h-9 w-56"
          />
        </form>
        <Segmented
          value={filters.success == null ? "all" : filters.success ? "ok" : "failed"}
          onValueChange={(v) => set({ success: v === "all" ? null : v === "ok" })}
          aria-label={t("admin.logins.result")}
          options={[
            { value: "all", label: t("common.all") },
            { value: "ok", label: t("admin.logins.successful") },
            { value: "failed", label: t("admin.logins.failed") },
          ]}
        />
        <DateRange from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
        {deferred.stale ? <Spinner className="text-muted-foreground" /> : null}
        <span className="ml-auto text-sm text-muted-foreground tabular">
          {t("admin.logins.failed_24h", { count: logins.data.pages[0].failed24h ?? 0 })}
        </span>
      </div>
      <DataTable
        data={logins.data.pages.flatMap((p) => p.items)}
        columns={columns}
        getRowId={(r) => String(r.id)}
        infinite={infiniteRows(logins)}
        empty={t("admin.logins.none")}
        caption={t("admin.backups.tabs.logins")}
      />
    </div>
  )
}

const kcol = tableHelper<AdminApiKey>()

function KeysTab({ filters, onFilters }: { filters: ApiKeyFilters; onFilters: (f: ApiKeyFilters) => void }) {
  const revokeReasonId = useId()
  const { t, intl } = useI18n()
  const dt = useDateTime()
  const deferred = useDeferredParams(filters)
  const { data } = useSuspenseQuery(allApiKeysQuery(deferred.params))
  const [revoking, setRevoking] = useState<AdminApiKey | null>(null)
  const [reason, setReason] = useState("")
  const revoke = useAction((v: { id: number; reason: string }) => revokeApiKeyAdminFn({ data: v }), {
    success: t("profile.key_revoked"),
    invalidate: [["admin", "api-keys"]],
  })
  const day = (at: string) => fmtDay(at.slice(0, 10), intl, { day: "numeric", month: "short", year: "numeric" })
  const columns = [
    kcol.accessor("ownerName", {
      header: () => t("admin.audit.person"),
      enableSorting: false,
      meta: { primary: true },
      cell: (c) => (
        <span className="min-w-0">
          <span className="block truncate">{c.getValue() || "–"}</span>
          <span className="block truncate text-xs text-muted-foreground">{c.row.original.ownerEmail}</span>
        </span>
      ),
    }),
    kcol.accessor("name", {
      header: () => t("common.name"),
      enableSorting: false,
      meta: { mobileLabel: t("common.name") },
      cell: (c) => (
        <span className="flex flex-col">
          <span>{c.getValue()}</span>
          <span className="font-mono text-xs text-muted-foreground">{c.row.original.start}…</span>
        </span>
      ),
    }),
    kcol.accessor((r) => r.scopes.join(" "), {
      id: "scopes",
      header: () => t("profile.scopes"),
      enableSorting: false,
      meta: { hideOnMobile: true },
      cell: (c) => (
        <span className="text-sm">
          {c.row.original.scopes.map((s) => t(`profile.scope.${s.replace(":", "_")}`)).join(", ")}
        </span>
      ),
    }),
    kcol.accessor("createdAt", {
      header: () => t("admin.backups.created_at"),
      enableSorting: false,
      meta: { hideOnMobile: true, className: "whitespace-nowrap text-muted-foreground" },
      cell: (c) => <span title={dt(c.getValue())}>{day(c.getValue())}</span>,
    }),
    kcol.accessor((r) => r.lastUsedAt ?? "", {
      id: "used",
      header: () => t("profile.last_used"),
      enableSorting: false,
      meta: { mobileLabel: t("profile.last_used"), className: "whitespace-nowrap text-muted-foreground" },
      cell: (c) =>
        c.row.original.lastUsedAt ? <RelativeTime at={c.row.original.lastUsedAt} /> : t("profile.never_used"),
    }),
    kcol.accessor((r) => r.expiresAt ?? "", {
      id: "status",
      header: () => t("profile.expires"),
      enableSorting: false,
      meta: { mobileLabel: t("profile.expires"), className: "whitespace-nowrap" },
      cell: (c) => {
        const k = c.row.original
        if (!k.enabled) return <StatusBadge tone="negative">{t("admin.api_keys.revoked")}</StatusBadge>
        if (k.expired) return <StatusBadge tone="neutral">{t("profile.expired")}</StatusBadge>
        return k.expiresAt ? day(k.expiresAt) : "–"
      },
    }),
    kcol.display({
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      meta: { className: "w-24 text-right" },
      cell: (c) =>
        c.row.original.enabled && !c.row.original.expired ? (
          <Button intent="negative" variant="ghost" size="sm" onClick={() => setRevoking(c.row.original)}>
            {t("profile.revoke")}
          </Button>
        ) : null,
    }),
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={filters.status}
          onValueChange={(v) => onFilters({ status: v, page: 1 })}
          aria-label={t("common.status")}
          options={API_KEY_STATUSES.map((v) => ({ value: v, label: t(v === "all" ? "common.all" : "common.active") }))}
        />
        {deferred.stale ? <Spinner className="text-muted-foreground" /> : null}
      </div>
      <DataTable
        data={data.items}
        columns={columns}
        getRowId={(r) => String(r.id)}
        pageSize={200}
        empty={t("profile.no_keys")}
        caption={t("admin.backups.tabs.keys")}
      />
      <ServerPager
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        onPage={(page) => onFilters({ ...filters, page })}
      />
      <ConfirmDialog
        open={revoking != null}
        onOpenChange={(o) => {
          if (!o) {
            setRevoking(null)
            setReason("")
          }
        }}
        title={t("admin.api_keys.revoke_title")}
        description={revoking ? `${revoking.name} (${revoking.ownerName})` : ""}
        confirmLabel={t("profile.revoke")}
        onConfirm={() => (revoking ? revoke.mutateAsync({ id: revoking.id, reason: reason.trim() }) : null)}
      >
        <Field>
          <FieldLabel htmlFor={revokeReasonId}>{t("common.reason")}</FieldLabel>
          <Textarea id={revokeReasonId} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  )
}
