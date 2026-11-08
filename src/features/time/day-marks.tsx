/** Small per-day markers shared by the week and month views: holiday/absence chips, findings, locks. */
import { AlertTriangle, Lock } from "lucide-react"
import { ColorDot } from "@/components/app/status-badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { PeriodView } from "./api"
import type { Day } from "./entry-dialog"
import { wallClock } from "./lib"

export type Finding = PeriodView["findings"][number]
export type LockedMonth = PeriodView["lockedMonths"][string]

/** Holiday and absence labels of a day (pending absences are marked as such). */
export function DayChips({ day, className, compact }: { day: Day; className?: string; compact?: boolean }) {
  const { t, absenceLabel, holidayName } = useI18n()
  if (!day.holiday && !day.absences.length) return null
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {day.holiday ? (
        <span className="inline-flex h-5 min-w-0 items-center gap-1 rounded-md bg-holiday/14 px-1.5 text-xs font-medium text-holiday">
          <span className="truncate">{holidayName(day.holiday.name)}</span>
          {day.holiday.fraction < 1 ? <span>½</span> : null}
        </span>
      ) : null}
      {day.absences.map((a) => (
        <span
          key={a.id}
          className={cn(
            "inline-flex h-5 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium",
            a.status === "pending" ? "border border-dashed text-muted-foreground" : "bg-absent/14 text-foreground",
          )}
          title={a.status === "pending" ? t("absences.status.pending") : undefined}
        >
          <ColorDot color={a.color} className="size-2" />
          {compact ? null : <span className="truncate">{absenceLabel({ key: a.typeKey, label: a.label })}</span>}
          {!compact && a.halves.length === 1 ? <span>½</span> : null}
          {a.status === "pending" ? <span className="sr-only">{t("absences.status.pending")}</span> : null}
        </span>
      ))}
    </span>
  )
}

/** Labour-law findings of a day as one warning chip; the rules show on hover/focus. */
export function FindingsBadge({
  findings,
  className,
  plain,
}: {
  findings: Finding[]
  className?: string
  plain?: boolean
}) {
  const { t } = useI18n()
  if (!findings.length) return null
  const violation = findings.some((f) => f.severity === "violation")
  const names = [...new Set(findings.map((f) => t(`compliance.rule.${f.rule}`)))]
  const cls = cn(
    "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium",
    violation ? "bg-destructive/12 text-destructive" : "bg-warning/14 text-warning",
    className,
  )
  const body = (
    <>
      <AlertTriangle className="size-3" aria-hidden />
      <span className="max-w-28 truncate">{names[0]}</span>
      {names.length > 1 ? <span className="tabular">+{names.length - 1}</span> : null}
    </>
  )
  // inside another control (a calendar day) the chip is plain text
  if (plain) return <span className={cls}>{body}</span>
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={names.join(", ")} className={cls} />}>
        {body}
      </TooltipTrigger>
      <TooltipContent>
        <ul>
          {findings.map((f) => (
            <li key={`${f.rule}${f.date ?? f.week}`}>
              {t(`compliance.rule.${f.rule}`)} · {f.ref}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

export function LockMark({ lock, className }: { lock: LockedMonth | undefined; className?: string }) {
  const { t, intl } = useI18n()
  const tz = useMe().timezone
  if (!lock) return null
  const date = fmtDay(wallClock(lock.signedAt, tz).date, intl)
  const text = t("time.locked_editor", { name: lock.signedBy ?? "?", date })
  return <Lock className={cn("size-3.5 shrink-0 text-positive", className)} aria-label={text} />
}
