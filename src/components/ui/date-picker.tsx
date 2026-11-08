/**
 * Date picker: a trigger with the geometry of an input (36 px, radius, surface) showing the date in the app
 * locale, opening a calendar popover (Monday first, today marked, arrow keys move by day, PageUp/PageDown by
 * month). Values are `YYYY-MM-DD` strings, "" when empty. `marks` adds coloured dots for days such as
 * holidays or absences; their names are read out with the day. `icon` shows a calendar icon, for toolbars
 * without a visible label.
 */
import { CalendarIcon } from "lucide-react"
import { useState } from "react"
import type { DateLibOptions, Modifiers } from "react-day-picker"
import { de, enGB, frCH, itCH } from "react-day-picker/locale"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// only bounds the month/year dropdowns, so a stale year in a long-running process does no harm
const THIS_YEAR = new Date().getFullYear()

const DAY_PICKER_LOCALES = { en: enGB, de, fr: frCH, it: itCH } as const

export interface DayMarks {
  /** modifier name → days (`YYYY-MM-DD`), colour class and the name read out with the day */
  [name: string]: { days: readonly string[]; color: string; label: string }
}

function toDate(iso: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** Shared look of the trigger: identical to `Input`. */
export const dateTriggerClass =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

export function DatePicker({
  value,
  onChange,
  onBlur,
  id,
  name,
  placeholder,
  min,
  max,
  disabled,
  invalid,
  marks,
  far = false,
  icon = false,
  className,
  "aria-describedby": describedBy,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  id?: string
  name?: string
  placeholder?: string
  min?: string
  max?: string
  disabled?: boolean
  invalid?: boolean
  marks?: DayMarks
  /** month and year dropdowns, for dates far from today (birth date, contract start) */
  far?: boolean
  icon?: boolean
  className?: string
  "aria-describedby"?: string
  "aria-label"?: string
}) {
  const { t, intl, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const selected = toDate(value)
  const [month, setMonth] = useState<Date | undefined>(selected)
  const minDate = min ? toDate(min) : undefined
  const maxDate = max ? toDate(max) : undefined
  const modifiers: Record<string, Date[]> = {}
  const dots: Record<string, string> = {}
  for (const [key, mark] of Object.entries(marks ?? {})) {
    modifiers[key] = mark.days.flatMap((d) => toDate(d) ?? [])
    dots[key] = mark.color
  }
  const dayLocale = DAY_PICKER_LOCALES[locale]

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setMonth(selected)
        else onBlur?.()
      }}
    >
      <PopoverTrigger
        id={id}
        name={name}
        disabled={disabled}
        data-slot="date-picker-trigger"
        data-field={name}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        className={cn(dateTriggerClass, className)}
      >
        {icon ? <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className={cn("min-w-0 flex-1 truncate tabular", !value && "text-muted-foreground")}>
          {value
            ? fmtDay(value, intl, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
            : (placeholder ?? t("common.pick_date"))}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1" align="start">
        <Calendar
          mode="single"
          required
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          onSelect={(d) => {
            if (!d) return
            onChange(toIso(d))
            setOpen(false)
          }}
          disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
          locale={dayLocale}
          captionLayout={far ? "dropdown" : "label"}
          startMonth={far ? new Date(THIS_YEAR - 90, 0) : undefined}
          endMonth={far ? new Date(THIS_YEAR + 10, 11) : undefined}
          modifiers={modifiers}
          dots={dots}
          labels={{
            labelDayButton: (date: Date, mods: Modifiers, options?: DateLibOptions) => {
              const base = date.toLocaleDateString(options?.locale?.code ?? intl, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })
              const extra = Object.entries(marks ?? {})
                .filter(([key]) => mods[key])
                .map(([, m]) => m.label)
              return [base, ...extra, ...(mods.today ? [t("common.today")] : [])].join(", ")
            },
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
