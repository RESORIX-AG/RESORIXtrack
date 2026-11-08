/**
 * "Clock in/out at a chosen time": a small popover with a time input. Clock-in: a time later than now means
 * the previous day (forgot to clock in last night). Clock-out: a past time closes the entry there, a future
 * time schedules the clock-out ("clock out later"). The server marks such entries as manual.
 */
import { History } from "lucide-react"
import { type ReactElement, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { addDaysStr } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { ClockStateName } from "@/server/services/clock"
import { hhmmToMin, minutesOfDay, todayIn, wallClock, wallToInstant } from "../time/lib"
import { TimeInput } from "../time/time-input"

/** A clock-out this many minutes ahead is scheduled (the server's tolerance for "now"). */
const LATER_AFTER_MIN = 2

export function CustomTimeButton({
  state,
  onSubmit,
  size = "icon-sm",
  trigger,
}: {
  state: ClockStateName
  onSubmit: (at: string) => void
  size?: "icon-sm" | "icon" | "icon-lg"
  trigger?: ReactElement
}) {
  const clockCustomTimeId = useId()
  const t = useT()
  const me = useMe()
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState("")
  const [nowMin, setNowMin] = useState(0)
  const [error, setError] = useState(false)
  const dir = state === "working" ? "out" : "in"
  const label = dir === "in" ? t("clock.custom_time_in") : t("clock.custom_time_out")
  const later = dir === "out" && time !== "" && hhmmToMin(time) > nowMin + LATER_AFTER_MIN
  const submitLabel = dir === "in" ? t("clock.start") : later ? t("clock.stop_later") : t("clock.stop")

  const submit = () => {
    if (!time) {
      setError(true)
      return
    }
    const tz = me.timezone
    const today = todayIn(tz)
    const date = dir === "in" && nowMin < hhmmToMin(time) ? addDaysStr(today, -1) : today
    onSubmit(wallToInstant(date, time, tz))
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setTime(wallClock(Date.now(), me.timezone).time)
          setNowMin(minutesOfDay(Date.now(), me.timezone))
          setError(false)
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                trigger ?? (
                  <Button variant="ghost" size={size} aria-label={label}>
                    <History />
                  </Button>
                )
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 shadow-overlay">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field data-invalid={error || undefined}>
            <FieldLabel htmlFor={clockCustomTimeId}>
              {dir === "in" ? t("clock.custom_time_label_in") : t("clock.custom_time_label_out")}
            </FieldLabel>
            <TimeInput
              id={clockCustomTimeId}
              value={time}
              onChange={(v) => {
                setTime(v)
                setError(false)
              }}
              aria-invalid={error || undefined}
            />
            <FieldDescription>
              {dir === "in" ? t("clock.custom_time_help_in") : t("clock.custom_time_help_out")}
            </FieldDescription>
          </Field>
          <Button type="submit">{submitLabel}</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
