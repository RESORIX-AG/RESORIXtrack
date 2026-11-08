/**
 * The dashboard's clock card: a ring that fills towards today's target, the live time, the state, a scheduled
 * clock-out ("clock out later"), the project (switch while working) and the actions (clock in/out, custom time,
 * add time manually in place, report sick).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, History, Thermometer } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/app/confirm"
import { Button, ButtonLink } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { reportSickTodayFn, sickCheckQuery } from "@/features/absences/api"
import { type Clock, ClockActions, ClockProject, OfflineBadge, ScheduledLine } from "@/features/clock/clock-control"
import { CustomTimeButton } from "@/features/clock/custom-time"
import { type LiveClock, liveWorkedMin, primaryAction } from "@/features/clock/use-clock"
import { useNow } from "@/features/clock/use-now"
import { useProjectMode } from "@/features/projects/project-picker"
import { AddEntryButton } from "@/features/time/add-entry-button"
import { invalidateTimeData } from "@/features/time/invalidate"
import { fmtClockTime, wallClock } from "@/features/time/lib"
import { Notice } from "@/features/time/notice"
import { fmtDay, fmtMinutes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"

const R = 76
const C = 2 * Math.PI * R

function Ring({ c, targetMin }: { c: LiveClock; targetMin: number }) {
  const { t } = useI18n()
  const now = useNow(c.state === "working")
  const worked = liveWorkedMin(c, now)
  const pct = targetMin > 0 ? Math.min(1, worked / targetMin) : worked > 0 ? 1 : 0
  const secs = Math.floor((worked * 60) % 60)
  return (
    <div className="relative size-44 shrink-0 sm:size-48">
      <svg viewBox="0 0 180 180" className="size-full -rotate-90" aria-hidden>
        <circle cx="90" cy="90" r={R} fill="none" strokeWidth="10" className="stroke-muted" />
        {pct > 0 ? (
          <circle
            cx="90"
            cy="90"
            r={R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            className="stroke-work transition-[stroke-dashoffset] duration-500 ease-out"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <p className="text-3xl font-semibold tracking-tight tabular" suppressHydrationWarning>
          {fmtMinutes(Math.floor(worked))}
          {c.state === "working" ? (
            <span className="text-base font-medium text-muted-foreground">:{String(secs).padStart(2, "0")}</span>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">{t("dashboard.ring_today")}</p>
      </div>
    </div>
  )
}

export function HeroClock({
  clock,
  today,
}: {
  clock: Clock
  today: { date: string; targetMin: number; absences: { category: string; status: string }[] }
}) {
  const clockTitleId = useId()
  const projectId = useId()
  const projectMode = useProjectMode()
  const { t, tError, intl } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const sick = useQuery(sickCheckQuery())
  const [confirmSick, setConfirmSick] = useState(false)
  const c = clock.data
  if (!c) return <Skeleton className="h-60 rounded-xl" />
  const hour12 = me.timeFormat === "12h"
  const tz = me.timezone
  const since = c.since ? wallClock(c.since, tz) : null
  // still running from a previous day (forgot to clock out)
  const overnight = c.state === "working" && since && since.date < today.date ? since : null
  const isSick = today.absences.some((a) => a.category === "sick" && a.status === "approved")
  const meta = [
    c.since && c.state !== "idle"
      ? t("dashboard.since", { time: fmtClockTime(wallClock(c.since, tz).time, hour12) })
      : null,
    today.targetMin > 0 ? t("dashboard.target_today", { target: fmtMinutes(today.targetMin) }) : t("dashboard.day_off"),
    c.todayBreakMin >= 1 ? t("dashboard.breaks", { time: fmtMinutes(c.todayBreakMin) }) : null,
  ].filter(Boolean)

  const reportSick = async () => {
    try {
      await reportSickTodayFn({ data: { note: "" } })
      await invalidateTimeData(qc)
      toast.success(t("dashboard.sick_done"))
    } catch (err) {
      toast.error(tError(err))
    }
  }

  return (
    <section
      aria-labelledby={clockTitleId}
      className="flex flex-col gap-4 rounded-xl border bg-gradient-hero p-5 sm:p-6"
    >
      {overnight ? (
        <Notice
          icon={AlertTriangle}
          tone="warning"
          action={
            <ButtonLink variant="ghost" size="sm" render={<Link to="/time" />}>
              {t("dashboard.overnight_fix")}
            </ButtonLink>
          }
        >
          {t("dashboard.overnight", {
            since: `${fmtDay(overnight.date, intl, { weekday: "short", day: "numeric", month: "short" })} ${fmtClockTime(overnight.time, hour12)}`,
          })}
        </Notice>
      ) : null}
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-10">
        <Ring c={c} targetMin={today.targetMin} />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-5 text-center sm:items-start sm:text-left">
          <div className="flex flex-col gap-1.5">
            <h2 id={clockTitleId} className="flex items-center gap-2 text-lg font-semibold">
              {isSick && c.state === "idle" ? t("dashboard.get_well") : t(`clock.headline.${c.state}`)}
              <OfflineBadge clock={clock} />
            </h2>
            <p className="text-sm text-muted-foreground tabular" suppressHydrationWarning>
              {meta.join(" · ")}
            </p>
            <ScheduledLine clock={clock} className="justify-center sm:justify-start" />
          </div>
          {projectMode !== "off" ? (
            <div className="flex w-full max-w-xs flex-col gap-1.5 text-left">
              <label htmlFor={projectId} className="text-xs text-muted-foreground">
                {c.state === "working" ? t("clock.project") : t("clock.next_project")}
              </label>
              <ClockProject clock={clock} place="hero" id={projectId} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <ClockActions clock={clock} size="lg" className="gap-2" custom={false} />
            <CustomTimeButton
              state={c.state}
              onSubmit={(at) => void clock.act(primaryAction(c.state), { at, custom: true })}
              trigger={
                <Button variant="ghost" size="lg">
                  <History data-icon="inline-start" />
                  {t("clock.custom_time")}
                </Button>
              }
            />
            <AddEntryButton size="lg" label={t("dashboard.forgot_clock")} />
            {sick.data?.allowed ? (
              <Button variant="ghost" size="lg" onClick={() => setConfirmSick(true)}>
                <Thermometer data-icon="inline-start" />
                {t("dashboard.report_sick")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmSick}
        onOpenChange={setConfirmSick}
        title={t("dashboard.sick_title")}
        description={t("dashboard.sick_message")}
        confirmLabel={t("dashboard.sick_confirm")}
        destructive={false}
        onConfirm={reportSick}
      />
    </section>
  )
}
