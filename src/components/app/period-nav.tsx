import { useRouter } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { type MouseEvent, type ReactNode, type TransitionStartFunction, ViewTransition } from "react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { PERIOD_TYPES, type PeriodStep, stepPeriod } from "@/lib/period-transition"
import { cn } from "@/lib/utils"

/** ‹ Label › with an optional "Today" jump. Used for weeks, months and years. */
export function PeriodNav({
  label,
  onPrev,
  onNext,
  onToday,
  isCurrent,
  canPrev = true,
  canNext = true,
  startTransition,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
  onToday?: () => void
  isCurrent?: boolean
  /** false at the first or last period with anything to show */
  canPrev?: boolean
  canNext?: boolean
  /** from `useTransition()` when the period is local state, to dim the old period while the next loads */
  startTransition?: TransitionStartFunction
}) {
  const t = useT()
  const router = useRouter()
  const step = (dir: PeriodStep, change: () => void) => (e: MouseEvent<HTMLButtonElement>) =>
    stepPeriod(router, dir, change, { from: e.currentTarget, start: startTransition })
  return (
    <div className="flex items-center gap-1">
      {/* keeps its space in the current period, so the arrows never move under the pointer */}
      {onToday ? (
        <Button
          variant="ghost"
          onClick={step("jump", onToday)}
          className={cn("mr-1", isCurrent && "invisible")}
          aria-hidden={isCurrent || undefined}
          tabIndex={isCurrent ? -1 : undefined}
        >
          {t("common.today")}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        onClick={step("back", onPrev)}
        disabled={!canPrev}
        aria-label={t("common.previous")}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-36 text-center text-sm font-semibold tabular" aria-live="polite">
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={step("forward", onNext)}
        disabled={!canNext}
        aria-label={t("common.next_period")}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}

const PERIOD_CLASS = {
  [PERIOD_TYPES.forward]: "period",
  [PERIOD_TYPES.back]: "period",
  [PERIOD_TYPES.jump]: "period",
  default: "none",
}

/**
 * The content that changes with a PeriodNav step (timeline, calendar, table). It slides in the direction of
 * the step; other updates do not animate. One visible per page.
 */
export function PeriodContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ViewTransition update={PERIOD_CLASS} enter="none" exit="none" share="none" default="none">
      <div data-period-view className={cn("min-w-0", className)}>
        {children}
      </div>
    </ViewTransition>
  )
}
