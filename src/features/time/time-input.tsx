/**
 * Time-of-day input that follows the profile's 24/12 h format in every browser. `value`/`onChange` use
 * "HH:MM" (24 h); typing is lenient ("930", "9.30", "9:30 pm") and committed on blur or Enter. Clicking or
 * typing opens a list of quarter hours scrolled to the current time; with `from` (an end time) the list
 * starts after it and shows each duration.
 */
import { Autocomplete } from "@base-ui/react/autocomplete"
import { useStore } from "@tanstack/react-form"
import { type ComponentProps, type ReactNode, useId, useState } from "react"
import { useFieldContext } from "@/components/form/form"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fmtMinutes } from "@/lib/format"
import { errorMessage } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { fmtClockTime, hhmmToMin, minToHhmm, parseTimeText } from "./lib"

const STEP = 15
const COMPLETE_TIME = /^\d{1,2}[:.]\d{2}(\s*[ap]\.?m?\.?)?$/i
const isComplete = (text: string) => COMPLETE_TIME.test(text.trim())

function suggestions(from: string | null): string[] {
  const first = from ? Math.floor(hhmmToMin(from) / STEP) * STEP + STEP : 0
  return Array.from({ length: 1440 / STEP }, (_, i) => minToHhmm(first + i * STEP)).filter((t) => t !== from)
}

/** The suggestion to scroll to: the current time rounded down to the step. */
function anchorOf(current: string | null): string | null {
  return current ? minToHhmm(Math.floor(hhmmToMin(current) / STEP) * STEP) : null
}

/** Scrolls the list so this item sits in the middle (runs once each time the anchor item changes). */
function centre(el: HTMLElement | null) {
  const list = el?.parentElement
  if (el && list) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2
}

export function TimeInput({
  value,
  onChange,
  onBlur,
  from,
  ...rest
}: {
  value: string
  onChange: (hhmm: string) => void
  onBlur?: () => void
  /** start time an end is measured from */
  from?: string
} & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "type">) {
  const hour12 = useMe().timeFormat === "12h"
  const shown = value ? fmtClockTime(value, hour12) : ""
  const [text, setText] = useState(shown)
  const [synced, setSynced] = useState(value)
  // an outside change (reset, default) replaces what is shown unless the typed text already means it
  if (synced !== value) {
    setSynced(value)
    if (parseTimeText(text) !== (value || null)) setText(shown)
  }
  const commit = (raw: string) => {
    const parsed = parseTimeText(raw)
    if (!raw.trim()) {
      if (value) onChange("")
    } else if (parsed) {
      setText(fmtClockTime(parsed, hour12))
      if (parsed !== value) onChange(parsed)
    }
  }
  const start = from ? parseTimeText(from) : null
  const items = suggestions(start)
  const current = parseTimeText(text) ?? (value || null)
  const anchor = anchorOf(current)
  const [open, setOpen] = useState(false)

  return (
    <Autocomplete.Root
      items={items}
      mode="none"
      open={open}
      onOpenChange={(next, { reason, event }) => {
        // typing reopens the list on every keystroke, also on the one that completes (and commits) a time
        const typedComplete =
          reason === "input-change" && event.target instanceof HTMLInputElement && isComplete(event.target.value)
        setOpen(next && !typedComplete)
      }}
      openOnInputClick
      value={text}
      itemToStringValue={(t: string) => fmtClockTime(t, hour12)}
      onValueChange={(next, details) => {
        setText(next)
        // a picked suggestion or a complete typed time applies at once; partial input waits for blur or Enter
        if (details.reason === "item-press") commit(next)
        else if (isComplete(next)) {
          commit(next)
          setOpen(false)
        }
      }}
    >
      <Autocomplete.Input
        render={<Input />}
        inputMode={hour12 ? "text" : "numeric"}
        autoComplete="off"
        placeholder={hour12 ? "h:mm AM" : "HH:MM"}
        className="tabular"
        {...rest}
        onBlur={() => {
          commit(text)
          onBlur?.()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(text)
            setOpen(false)
          }
          rest.onKeyDown?.(e)
        }}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="isolate z-50" sideOffset={4} align="start">
          <Autocomplete.Popup className="w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <Autocomplete.List className="relative max-h-64 overflow-y-auto overscroll-contain p-1 outline-none">
              {(t: string) => (
                <Autocomplete.Item
                  key={t}
                  value={t}
                  ref={t === anchor ? centre : undefined}
                  data-current={t === current ? "" : undefined}
                  className="flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm tabular outline-hidden select-none data-current:font-semibold data-current:text-primary data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  {fmtClockTime(t, hour12)}
                  {start ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {fmtMinutes((hhmmToMin(t) - hhmmToMin(start) + 1440) % 1440)}
                    </span>
                  ) : null}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}

/** TimeInput bound to a TanStack form field (use inside `form.AppField`). */
export function TimeField({
  label,
  description,
  from,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  from?: string
  className?: string
}) {
  const field = useFieldContext<string>()
  const { t } = useI18n()
  const submitted = useStore(field.form.store, (s) => s.submissionAttempts > 0)
  const raw =
    (field.state.meta.isBlurred || submitted) && field.state.meta.errors.length ? field.state.meta.errors[0] : null
  const error = raw ? t(typeof raw === "string" ? raw : (errorMessage(raw) ?? "")) : ""
  const id = `${useId()}${field.name}`
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <TimeInput
        id={id}
        name={field.name}
        data-field={field.name}
        value={field.state.value ?? ""}
        from={from}
        onChange={(v) => field.handleChange(v)}
        onBlur={field.handleBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error ? (
        <FieldError id={`${id}-err`}>{error}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}
