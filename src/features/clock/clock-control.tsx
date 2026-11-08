/**
 * Clock in / clock out control: a compact pill in the desktop top bar and a sticky bar above the tab bar on
 * phones. One primary action per state; "custom time" is secondary. A break is simply a clock-out. With a
 * scheduled clock-out ("clock out later") the primary action reads "Clock out now" and the bars show
 * "until 17:30". Keyboard: S clocks in/out (only when no input has focus). Offline clicks queue and show as
 * pending until they are synced. With projects on, the state text names the running entry's project and
 * `ClockProject` picks it (switches while working, sets the next clock-in's project while idle), on the
 * dashboard and in the top bar.
 */
import { useQuery } from "@tanstack/react-query"
import { CloudOff, Play, Square, Timer } from "lucide-react"
import { type ReactElement, useEffect, useEffectEvent } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { projectsQuery } from "@/features/projects/api"
import { ProjectPicker, projectShort, useProjectMode } from "@/features/projects/project-picker"
import { fmtMinutes } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { ClockStateName } from "@/server/services/clock"
import { CustomTimeButton } from "./custom-time"
import { PICKER_ATTR, useNextProject, useProjectPrompt, visibleProjectPicker, writeNextProject } from "./next-project"
import { registerServiceWorker } from "./register-sw"
import { type LiveClock, liveWorkedMin, primaryAction, scheduledTimeText, useClock } from "./use-clock"
import { useNow } from "./use-now"

export type Clock = ReturnType<typeof useClock>

export function ClockControl({ variant }: { variant: "topbar" | "bar" }) {
  const clock = useClock()
  if (variant === "topbar") return <TopbarClock clock={clock} />
  return <MobileClockBar clock={clock} />
}

const STATE_DOT: Record<ClockStateName, string> = {
  idle: "bg-faint-foreground",
  working: "bg-work",
}

/** h:mm of today's work, ticking while working. */
function LiveFigure({ c, className }: { c: LiveClock; className?: string }) {
  const now = useNow(c.state === "working")
  return (
    <span className={cn("tabular", className)} suppressHydrationWarning>
      {fmtMinutes(Math.floor(liveWorkedMin(c, now)))}
    </span>
  )
}

/**
 * "Working", "Not clocked in" or "until 17:30" while a clock-out is scheduled; plus the running project
 * unless a picker next to it shows it.
 */
function StateText({ c, withProject = true }: { c: LiveClock; withProject?: boolean }) {
  const t = useT()
  const me = useMe()
  const project = withProject && c.state === "working" && c.entry?.project ? ` · ${projectShort(c.entry.project)}` : ""
  if (c.scheduledEnd) return `${t("clock.scheduled_short", { time: scheduledTimeText(c.scheduledEnd, me) })}${project}`
  return c.state === "working" ? `${t("clock.state.working")}${project}` : t(`clock.state.${c.state}`)
}

/**
 * The clock's project: while working, choosing one switches the running entry (no break); while idle it is
 * the project of the next clock-in. Nothing when projects are off.
 */
export function ClockProject({
  clock,
  place,
  id,
  className,
}: {
  clock: Clock
  place: "hero" | "topbar"
  id?: string
  className?: string
}) {
  const t = useT()
  const me = useMe()
  const mode = useProjectMode()
  const [next, setNext] = useNextProject(me.id)
  const prompted = useProjectPrompt()
  const projects = useQuery({ ...projectsQuery(), enabled: mode !== "off" }).data?.items
  const c = clock.data
  useEffect(() => {
    if (prompted) visibleProjectPicker()?.focus()
  }, [prompted])
  // a choice for a project that is gone (deactivated, membership ended) is no choice
  const stale = next != null && projects != null && !projects.some((p) => p.id === next)
  useEffect(() => {
    if (stale) writeNextProject(me.id, null)
  }, [stale, me.id])
  if (mode === "off" || !c) return null
  const working = c.state === "working"
  // the entry is null right after an optimistic switch: show the choice until the server answers
  const value = working && c.entry ? c.entry.projectId : next
  // required: flag a running entry without one, and an idle clock only after a clock-in was tried without one
  const missing =
    mode === "required" && (working ? c.entry != null && c.entry.projectId == null : prompted && value == null)
  return (
    <div {...{ [PICKER_ATTR]: place }} className={className}>
      <ProjectPicker
        id={id}
        className={place === "topbar" ? "h-7 rounded-sm" : undefined}
        aria-label={t("clock.project")}
        value={stale ? null : value}
        current={working ? c.entry?.project : null}
        invalid={missing}
        onChange={(projectId) => {
          setNext(projectId)
          if (working) void clock.act("switch", { projectId })
        }}
      />
    </div>
  )
}

/** S: clock in/out. Ignored while typing or while an overlay is open. */
function useShortcuts(clock: Clock) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const state = clock.data?.state
    if (!state || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
    const el = e.target
    if (el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))
      return
    if (document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) return
    if (e.key.toLowerCase() === "s") {
      e.preventDefault()
      void clock.act(primaryAction(state))
    }
  })
  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

function ShortcutTip({ label, keyName, children }: { label: string; keyName?: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="flex items-center gap-2">
        {label}
        {keyName ? <Kbd>{keyName}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** The primary action for the current state, with the custom-time popover (both bars and the dashboard card). */
export function ClockActions({
  clock,
  size = "sm",
  labels = true,
  custom = true,
  className,
}: {
  clock: Clock
  size?: "sm" | "default" | "lg"
  labels?: boolean
  custom?: boolean
  className?: string
}) {
  const t = useT()
  const c = clock.data
  if (!c) return null
  const primary = primaryAction(c.state)
  const PrimaryIcon = primary === "start" ? Play : Square
  const iconSize = size === "lg" ? "icon-lg" : size === "default" ? "icon" : "icon-sm"
  const primaryLabel = primary === "start" ? t("clock.start") : c.scheduledEnd ? t("clock.stop_now") : t("clock.stop")
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {custom ? (
        <CustomTimeButton
          state={c.state}
          size={iconSize}
          onSubmit={(at) => void clock.act(primary, { at, custom: true })}
        />
      ) : null}
      <ShortcutTip label={primaryLabel} keyName="S">
        <Button
          size={labels ? size : iconSize}
          aria-label={labels ? undefined : primaryLabel}
          onClick={() => void clock.act(primary)}
          className={cn(labels && size !== "lg" && "min-w-24", labels && size === "lg" && "min-w-36 px-4")}
        >
          <PrimaryIcon data-icon="inline-start" className={primary === "stop" ? "fill-current" : undefined} />
          {labels ? primaryLabel : null}
        </Button>
      </ShortcutTip>
    </div>
  )
}

/** "Clocks out automatically at 17:30" with a Cancel button; nothing while no clock-out is scheduled. */
export function ScheduledLine({ clock, className }: { clock: Clock; className?: string }) {
  const t = useT()
  const me = useMe()
  const c = clock.data
  if (!c?.scheduledEnd) return null
  return (
    <p className={cn("flex flex-wrap items-center gap-2 text-sm text-muted-foreground", className)}>
      <Timer className="size-4 shrink-0" aria-hidden />
      <span>{t("clock.scheduled", { time: scheduledTimeText(c.scheduledEnd, me) })}</span>
      <Button variant="ghost" size="sm" intent="negative" onClick={() => void clock.act("unschedule")}>
        {t("clock.cancel_scheduled")}
      </Button>
    </p>
  )
}

export function OfflineBadge({ clock, compact }: { clock: Clock; compact?: boolean }) {
  const t = useT()
  if (clock.online && !clock.pending) return null
  const text = clock.pending ? t("clock.pending", { count: clock.pending }) : t("clock.offline")
  return (
    <output
      className="inline-flex h-5 items-center gap-1 rounded-md bg-warning/14 px-1.5 text-xs font-medium text-warning"
      title={compact ? text : undefined}
    >
      <CloudOff className="size-3.5" aria-hidden />
      {compact ? (
        <>
          {clock.pending ? <span className="tabular">{clock.pending}</span> : null}
          <span className="sr-only">{text}</span>
        </>
      ) : (
        text
      )}
    </output>
  )
}

function TopbarClock({ clock }: { clock: Clock }) {
  const t = useT()
  const projects = useProjectMode() !== "off"
  useShortcuts(clock)
  useEffect(registerServiceWorker, [])
  const c = clock.data
  if (!c) return <Skeleton className="h-9 w-52 rounded-lg" />
  return (
    <fieldset
      className="m-0 flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3"
      aria-label={t("clock.label")}
    >
      <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[c.state])} aria-hidden />
      <LiveFigure c={c} className="text-sm font-semibold" />
      <span className="hidden text-xs text-muted-foreground xl:inline">
        <StateText c={c} withProject={!projects} />
      </span>
      <span className="sr-only xl:hidden">
        <StateText c={c} />
      </span>
      <OfflineBadge clock={clock} compact />
      <ClockProject clock={clock} place="topbar" className="hidden w-36 lg:block" />
      <ClockActions clock={clock} className="[&_[data-slot=button]]:rounded-sm" />
    </fieldset>
  )
}

function MobileClockBar({ clock }: { clock: Clock }) {
  const t = useT()
  const c = clock.data
  if (!c) return <Skeleton className="h-14 w-full rounded-xl" />
  return (
    <fieldset
      className="flex h-14 items-center gap-3 rounded-xl border bg-card/95 pr-2 pl-4 shadow-overlay backdrop-blur m-0 min-w-0"
      aria-label={t("clock.label")}
    >
      <span className={cn("size-2.5 shrink-0 rounded-full", STATE_DOT[c.state])} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <LiveFigure c={c} className="text-base font-semibold" />
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <StateText c={c} />
          <OfflineBadge clock={clock} compact />
        </span>
      </div>
      <ClockActions clock={clock} size="default" />
    </fieldset>
  )
}
