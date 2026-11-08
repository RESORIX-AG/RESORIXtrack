/** All entries of the period as a table (newest first) with their projects; corrections by others show who and why. */
import { History, RotateCcw } from "lucide-react"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { fmtDay, fmtMinutes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { useProjectMode } from "../projects/project-picker"
import type { Correction } from "./api"
import type { Entry } from "./entry-dialog"
import { fmtClockTime, wallClock } from "./lib"

const col = tableHelper<Entry>()

function EntryFlag({ e }: { e: Entry }) {
  const { t } = useI18n()
  return e.deleted ? (
    <StatusBadge tone="negative">{t("time.deleted_badge")}</StatusBadge>
  ) : e.corrected ? (
    <StatusBadge tone="warning" icon="warning">
      {t("time.corrected")}
    </StatusBadge>
  ) : e.edited ? (
    <StatusBadge>{t("time.edited")}</StatusBadge>
  ) : e.source === "manual" ? (
    <StatusBadge>{t("time.manual")}</StatusBadge>
  ) : null
}

function CorrectionLine({ corr }: { corr: Correction | undefined }) {
  const { t } = useI18n()
  if (!corr) return null
  return (
    <span className="text-xs text-warning">
      {t("time.changed_by", { name: corr.by })}
      {corr.reason ? <span className="text-muted-foreground"> · “{corr.reason}”</span> : null}
    </span>
  )
}

export function EntriesTable({
  entries,
  tz,
  corrections,
  needsProject,
  canEdit,
  onEdit,
  onHistory,
  onRestore,
  toolbar,
}: {
  entries: Entry[]
  tz: string
  corrections: Record<number, Correction>
  /** work that still needs a project: tinted, with a badge */
  needsProject?: ReadonlySet<number>
  canEdit: boolean
  onEdit: (e: Entry) => void
  onHistory: (e: Entry) => void
  onRestore: (e: Entry) => void
  toolbar?: React.ReactNode
}) {
  const { t, intl } = useI18n()
  const hour12 = useMe().timeFormat === "12h"
  const showProjects = useProjectMode() !== "off" || entries.some((e) => e.project)
  const rows = [...entries].sort((a, b) => b.startAt.localeCompare(a.startAt))
  const columns = [
    col.accessor("startAt", {
      id: "date",
      header: () => t("common.date"),
      meta: { primary: true, mobileLabel: t("common.date"), width: "11rem" },
      cell: (c) => {
        const e = c.row.original
        return (
          <span className="flex flex-col gap-1">
            <span
              className={cn(
                // phones: the badge moves below the date when the row is too narrow
                "flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap",
                e.deleted && "text-muted-foreground line-through",
              )}
            >
              <span
                className={cn("size-2 shrink-0 rounded-full", e.kind === "work" ? "bg-work" : "bg-break")}
                aria-hidden
              />
              <span className="whitespace-nowrap">
                {fmtDay(wallClock(e.startAt, tz).date, intl, { weekday: "short", day: "numeric", month: "short" })}
              </span>
              <span className="sr-only">{t(`time.kind.${e.kind}`)}</span>
              <span className="ml-auto md:hidden">
                <EntryFlag e={e} />
              </span>
            </span>
            {/* phones: the note and correction live in the row title (empty columns are hidden there) */}
            {e.note ? (
              <span className="truncate text-sm font-normal text-muted-foreground md:hidden">{e.note}</span>
            ) : null}
            <span className="font-normal md:hidden">
              <CorrectionLine corr={corrections[e.id]} />
            </span>
          </span>
        )
      },
    }),
    col.accessor((e) => e.startAt, {
      id: "time",
      header: () => t("time.from_to"),
      enableSorting: false,
      meta: { mobileLabel: t("time.from_to"), width: "11rem" },
      cell: (c) => {
        const e = c.row.original
        return (
          <span className="whitespace-nowrap tabular">
            {fmtClockTime(wallClock(e.startAt, tz).time, hour12)}–
            {e.endAt ? (
              fmtClockTime(wallClock(e.endAt, tz).time, hour12)
            ) : (
              <StatusBadge tone="brand">{t("time.running")}</StatusBadge>
            )}
          </span>
        )
      },
    }),
    col.accessor("minutes", {
      header: () => t("time.duration"),
      meta: { numeric: true, mobileLabel: t("time.duration"), width: "7rem" },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    ...(showProjects
      ? [
          col.accessor((e) => e.project?.name ?? "", {
            id: "project",
            header: () => t("time.project"),
            meta: { mobileLabel: t("time.project") },
            cell: (c) => {
              const e = c.row.original
              if (needsProject?.has(e.id))
                return (
                  <StatusBadge tone="info" icon="warning">
                    {t("time.project_missing")}
                  </StatusBadge>
                )
              if (!e.project) return <span className="text-muted-foreground">–</span>
              return (
                <span className="flex min-w-0 items-center gap-2">
                  <ColorDot color={e.project.color} />
                  <span className="truncate">{e.project.name}</span>
                </span>
              )
            },
          }),
        ]
      : []),
    col.accessor("note", {
      header: () => t("common.note"),
      enableSorting: false,
      meta: { hideOnMobile: true },
      cell: (c) => {
        const e = c.row.original
        return (
          <span className="flex min-w-0 flex-col gap-1">
            {e.note ? <span className="line-clamp-1 max-w-72 break-all text-muted-foreground">{e.note}</span> : null}
            <CorrectionLine corr={corrections[e.id]} />
          </span>
        )
      },
    }),
    col.display({
      id: "flags",
      header: () => <span className="sr-only">{t("common.status")}</span>,
      meta: { hideOnMobile: true },
      cell: (c) => <EntryFlag e={c.row.original} />,
    }),
    // row actions; on phones the row opens the entry, whose dialog offers history and restore
    col.display({
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      meta: { numeric: true, hideOnMobile: true, width: "7rem" },
      cell: (c) => {
        const e = c.row.original
        return (
          <span className="inline-flex items-center justify-end">
            {e.deleted && canEdit ? (
              <Button
                intent="positive"
                variant="ghost"
                size="icon-sm"
                aria-label={t("time.restore")}
                title={t("time.restore")}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onRestore(e)
                }}
              >
                <RotateCcw />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("time.history")}
              title={t("time.history")}
              onClick={(ev) => {
                ev.stopPropagation()
                onHistory(e)
              }}
            >
              <History />
            </Button>
          </span>
        )
      },
    }),
  ]
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(e) => String(e.id)}
      onRowClick={onEdit}
      caption={t("time.entries")}
      toolbar={toolbar}
      pageSize={false}
      empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("time.no_entries")}</p>}
      rowClassName={(e) =>
        needsProject?.has(e.id) ? "bg-info/10" : e.corrected && !e.deleted ? "bg-warning/5" : undefined
      }
    />
  )
}
