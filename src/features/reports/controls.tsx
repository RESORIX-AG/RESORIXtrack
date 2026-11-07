/**
 * Report controls: period pickers, team and person filters, and file downloads.
 */
import { Download } from "lucide-react"
import { type TransitionStartFunction, useState } from "react"
import { toast } from "sonner"
import { PeriodNav } from "@/components/app/period-nav"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { FilterSelect } from "@/features/admin/ui"
import type { TeamScope } from "@/features/team/scope"
import { useToday } from "@/features/team/use-today"
import { failure } from "@/lib/attempt"
import { addMonthsStr, dateFormat, fmtMonth, monthRange } from "@/lib/format"
import { isOneOf, isRecord } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"

export type Format = "pdf" | "xlsx" | "csv"

const PRESETS = ["this_month", "last_month", "this_year", "last_year"] as const
type Preset = (typeof PRESETS)[number] | "custom"

function presetRange(p: Exclude<Preset, "custom">, today: string): { from: string; to: string } {
  const month = today.slice(0, 7)
  const year = Number(today.slice(0, 4))
  if (p === "this_month") return monthRange(month)
  if (p === "last_month") return monthRange(addMonthsStr(month, -1))
  if (p === "this_year") return { from: `${year}-01-01`, to: `${year}-12-31` }
  return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
}

/** Month navigator for the timesheet (‹ October 2026 ›). */
export function MonthNav({
  month,
  today,
  onChange,
  startTransition,
}: {
  month: string
  today: string
  onChange: (month: string) => void
  startTransition?: TransitionStartFunction
}) {
  const { intl } = useI18n()
  return (
    <PeriodNav
      startTransition={startTransition}
      label={fmtMonth(month, intl)}
      onPrev={() => onChange(addMonthsStr(month, -1))}
      onNext={() => onChange(addMonthsStr(month, 1))}
      onToday={() => onChange(today.slice(0, 7))}
      isCurrent={month === today.slice(0, 7)}
    />
  )
}

/** Period as a preset (this month, last year …) or custom dates. */
export function RangePicker({
  from,
  to,
  today,
  onChange,
}: {
  from: string
  to: string
  today: string
  onChange: (r: { from: string; to: string }) => void
}) {
  const { t } = useI18n()
  const matched = PRESETS.find((p) => {
    const r = presetRange(p, today)
    return r.from === from && r.to === to
  })
  const [custom, setCustom] = useState(!matched)
  const preset: Preset = custom || !matched ? "custom" : matched
  const items = [...PRESETS, "custom" as const].map((p) => ({ value: p, label: t(`reports.preset.${p}`) }))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={items}
        value={preset}
        onValueChange={(v) => {
          if (!isOneOf(PRESETS, v)) {
            setCustom(true)
            return
          }
          setCustom(false)
          onChange(presetRange(v, today))
        }}
      >
        <SelectTrigger aria-label={t("reports.period")} className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" ? (
        <>
          <DatePicker
            icon
            className="w-44"
            aria-label={t("common.from")}
            value={from}
            max={to}
            onChange={(v) => v && onChange({ from: v, to: to < v ? v : to })}
          />
          <DatePicker
            icon
            className="w-44"
            aria-label={t("common.to")}
            value={to}
            min={from}
            onChange={(v) => v && onChange({ from: from > v ? v : from, to: v })}
          />
        </>
      ) : null}
    </div>
  )
}

/** Year + month (or the whole year) for the balances report. */
export function YearMonthPicker({
  year,
  month,
  onChange,
}: {
  year: number
  month: number | null
  onChange: (v: { year: number; month: number | null }) => void
}) {
  const { t, intl } = useI18n()
  const base = Math.max(year, Number(useToday().slice(0, 4)))
  const years = Array.from({ length: 6 }, (_, i) => base - 5 + i)
  const monthFmt = dateFormat(intl, { month: "long", timeZone: "UTC" })
  const yearItems = years.map((y) => ({ value: String(y), label: y }))
  const monthItems = [
    { value: "0", label: t("reports.whole_year") },
    ...Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: monthFmt.format(new Date(Date.UTC(2000, i, 1))),
    })),
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select items={yearItems} value={String(year)} onValueChange={(v) => v && onChange({ year: Number(v), month })}>
        <SelectTrigger aria-label={t("common.year")} className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {yearItems.map((y) => (
            <SelectItem key={y.value} value={y.value}>
              {y.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={monthItems}
        value={String(month ?? 0)}
        onValueChange={(v) => v && onChange({ year, month: v === "0" ? null : Number(v) })}
      >
        <SelectTrigger aria-label={t("common.month")} className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {monthItems.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** "All teams" + the teams in scope; hidden when there is nothing to choose. */
export function TeamFilter({
  scope,
  value,
  onChange,
}: {
  scope: TeamScope
  value: number | undefined
  onChange: (teamId: number | undefined) => void
}) {
  const { t } = useI18n()
  if (scope.teams.length < 2) return null
  return (
    <FilterSelect
      searchable
      label={t("common.team")}
      value={value ? String(value) : ""}
      onChange={(v) => onChange(v ? Number(v) : undefined)}
      options={[
        { value: "", label: t("reports.all_teams") },
        ...scope.teams.map((tm) => ({ value: String(tm.id), label: tm.name })),
      ]}
    />
  )
}

export function PersonPicker({
  scope,
  value,
  meId,
  onChange,
}: {
  scope: TeamScope
  value: number
  meId: number
  onChange: (userId: number) => void
}) {
  const { t } = useI18n()
  const teams = new Map(scope.teams.map((tm) => [tm.id, tm.name]))
  return (
    <Combobox
      className="h-8 sm:w-64"
      value={String(value)}
      onChange={(v) => v && onChange(Number(v))}
      placeholder={t("reports.person")}
      options={scope.people.map((p) => ({
        value: String(p.id),
        label: p.id === meId ? `${p.name} (${t("common.you")})` : p.name,
        hint: !p.isActive ? t("common.inactive") : p.teamId != null ? teams.get(p.teamId) : undefined,
      }))}
    />
  )
}

/** Fetches a report file and hands it to the browser. */
async function saveReport(kind: string, params: Record<string, string | number | null | undefined>, format: Format) {
  const q = new URLSearchParams({ format })
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v))
  const res = await fetch(`/api/reports/${kind}?${q}`, { credentials: "same-origin" })
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    throw isRecord(body) && body.error ? body.error : new Error(res.statusText)
  }
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1]
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement("a")
  a.href = url
  a.download = name ? decodeURIComponent(name) : `${kind}.${format}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Report downloads with a busy format; errors become a toast. */
export function useDownload() {
  const { tError } = useI18n()
  const [busy, setBusy] = useState<Format | null>(null)
  async function download(kind: string, params: Record<string, string | number | null | undefined>, format: Format) {
    setBusy(format)
    const failed = await failure(saveReport(kind, params, format))
    setBusy(null)
    if (failed) toast.error(tError(failed.error))
  }
  return { busy, download }
}

export function DownloadButtons({
  formats,
  busy,
  onDownload,
}: {
  formats: Format[]
  busy: Format | null
  onDownload: (f: Format) => void
}) {
  return (
    <>
      {formats.map((f, i) => (
        <Button key={f} variant={i === 0 ? "default" : "outline"} onClick={() => onDownload(f)} disabled={busy != null}>
          {busy === f ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
          {f.toUpperCase()}
        </Button>
      ))}
    </>
  )
}
