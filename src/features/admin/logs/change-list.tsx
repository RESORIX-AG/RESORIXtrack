import { useQuery } from "@tanstack/react-query"
import { projectsQuery } from "@/features/projects/api"
import { isAppReason } from "@/features/time/entry-history"
import { fmtDateTime, fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { Json, JsonObject } from "@/lib/json"
import { useMe } from "@/lib/session"

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Reasons the app writes itself (clocking) are not shown. */
const shownReason = (r: string | null | undefined) => (r && !isAppReason(r) ? r : "")

/**
 * Change-log fields and values as people read them: translated field names, times in the viewer's zone,
 * Ja/Nein, Arbeit/Pause, translated sources and statuses. Reasons the app writes itself are dropped.
 */
export function useAuditFormat() {
  const { t, has, intl } = useI18n()
  const me = useMe()
  const hour12 = me.timeFormat === "12h"
  const projects = useQuery(projectsQuery(true)).data?.items ?? []
  const projectNames = new Map(projects.map((p) => [p.id, p.name]))
  const label = (k: string) => (has(`admin.audit.fields.${k}`) ? t(`admin.audit.fields.${k}`) : k)
  const value = (k: string, v: Json | undefined): string => {
    if (v == null || v === "") return "–"
    if (typeof v === "boolean") return t(v ? "common.yes" : "common.no")
    if (k === "project_id" && typeof v === "number") return projectNames.get(v) ?? `#${v}`
    if (typeof v === "string") {
      if (INSTANT.test(v)) return fmtDateTime(v, { intl, tz: me.timezone, hour12 })
      if (DAY.test(v)) return fmtDay(v, intl, { day: "numeric", month: "short", year: "numeric" })
      if (k === "kind" && has(`time.kind.${v}`)) return t(`time.kind.${v}`)
      if (k === "source" && has(`admin.audit.sources.${v}`)) return t(`admin.audit.sources.${v}`)
      if (k === "status" && has(`absences.status.${v}`)) return t(`absences.status.${v}`)
      return v
    }
    return typeof v === "object" ? JSON.stringify(v) : String(v)
  }
  return { label, value, reason: shownReason }
}

/** Changed fields of a change-log entry as "Field: old → new", plus the reason. */
export function ChangeList({
  item,
  max = 4,
}: {
  item: { changed: string[]; before: JsonObject | null; after: JsonObject | null; reason: string }
  max?: number
}) {
  const f = useAuditFormat()
  const keys = item.changed.slice(0, max)
  const reason = f.reason(item.reason)
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-sm">
      {keys.map((k) => (
        <span key={k} className="truncate">
          <span className="text-muted-foreground">{f.label(k)}:</span>{" "}
          <span className="tabular">{f.value(k, item.before?.[k])}</span>
          <span className="text-muted-foreground"> → </span>
          <span className="tabular">{f.value(k, item.after?.[k])}</span>
        </span>
      ))}
      {item.changed.length > max ? (
        <span className="text-xs text-muted-foreground">+{item.changed.length - max}</span>
      ) : null}
      {reason ? <span className="truncate text-xs text-muted-foreground italic">{reason}</span> : null}
    </div>
  )
}
