/**
 * Add or edit a time entry (bottom sheet on phones). Times are wall-clock times in the owner's timezone;
 * an end before the start means the next day (night shifts). Unchanged times are not sent, so clocked
 * entries keep their seconds. A reason is asked for when the change needs one (someone else's entry, or
 * past days when the company requires it). Delete runs at once with Undo.
 */

import { useStore } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { History, Lock, RotateCcw, Trash2, UserPen } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ResponsiveDialog } from "@/components/app/responsive-dialog"
import { Segmented } from "@/components/app/segmented"
import { undoToast } from "@/components/app/undo-toast"
import { focusField } from "@/components/form/focus-field"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { failure } from "@/lib/attempt"
import { addDaysStr, fmtDay, fmtMinutes } from "@/lib/format"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { type Correction, createEntryFn, deleteEntryFn, type PeriodView, restoreEntryFn, updateEntryFn } from "./api"
import { invalidateTimeData } from "./invalidate"
import { hhmmToMin, minToHhmm, newEntryTimes, parseDuration, wallClock } from "./lib"
import { Notice } from "./notice"
import { TimeField } from "./time-input"

export type Entry = PeriodView["entries"][number]
export type Day = PeriodView["days"][number]

export interface EntryTarget {
  entry?: Entry
  date: string
  start?: string
}

export interface EntryContext {
  owner: PeriodView["user"]
  self: boolean
  today: string
  lockedMonths: PeriodView["lockedMonths"]
  reasonRequired: PeriodView["reasonRequired"]
  canEdit: boolean
}

const ENTRY_MODES = ["times", "total"] as const

interface Values {
  mode: (typeof ENTRY_MODES)[number]
  date: string
  start: string
  end: string
  total: string
  note: string
  reason: string
}

function defaults(target: EntryTarget, ctx: EntryContext): Values {
  const e = target.entry
  const tz = ctx.owner.timezone
  if (e) {
    const s = wallClock(e.startAt, tz)
    const end = e.endAt ? wallClock(e.endAt, tz).time : ""
    return {
      mode: "times",
      date: s.date,
      start: s.time,
      end,
      total: fmtMinutes(e.minutes),
      note: e.note,
      reason: "",
    }
  }
  const { start, end } = newEntryTimes(
    hhmmToMin(wallClock(Date.now(), tz).time),
    target.date === ctx.today,
    target.start,
  )
  return {
    mode: ctx.owner.recordingMode === "simplified" ? "total" : "times",
    date: target.date,
    start,
    end,
    total: "",
    note: "",
    reason: "",
  }
}

function reasonNeeded(v: Values, initial: Values, ctx: EntryContext): boolean {
  return ctx.reasonRequired.always || (ctx.reasonRequired.pastDays && (v.date < ctx.today || initial.date < ctx.today))
}

function validateEntry(
  v: Values,
  initial: Values,
  ctx: EntryContext,
  entry: Entry | undefined,
): Record<string, string> {
  const f: Record<string, string> = {}
  if (!v.date) f.date = "errors.fields.required"
  else if (v.date > ctx.today) f.date = "errors.fields.future"
  if (v.mode === "times") {
    if (!v.start) f.start = "errors.fields.required"
    if (!v.end && !entry?.running) f.end = "errors.fields.required"
    if (v.start && v.end && v.start === v.end) f.end = "errors.fields.before_start"
  } else {
    const m = parseDuration(v.total)
    if (m == null || m <= 0 || m > 24 * 60) f.total = "errors.fields.invalid"
  }
  if (reasonNeeded(v, initial, ctx) && !v.reason.trim()) f.reason = "time.reason_missing"
  return f
}

/** Creates the entry, or sends only what changed (unchanged times keep a clocked entry's seconds). */
async function saveEntry(v: Values, initial: Values, ctx: EntryContext, entry: Entry | undefined) {
  let start = v.start
  let end = v.end
  if (v.mode === "total") {
    start = entry ? initial.start : "08:00"
    end = minToHhmm(hhmmToMin(start) + (parseDuration(v.total) ?? 0))
  }
  const endDate =
    end &&
    (hhmmToMin(end) <= hhmmToMin(start) ||
      (v.mode === "total" && hhmmToMin(start) + (parseDuration(v.total) ?? 0) >= 1440))
      ? addDaysStr(v.date, 1)
      : v.date
  const startAt = `${v.date}T${start}:00`
  const endAt = end ? `${endDate}T${end}:00` : null
  if (!entry) {
    await createEntryFn({
      data: {
        userId: ctx.self ? null : ctx.owner.id,
        startAt,
        endAt: endAt ?? startAt,
        note: v.note,
        reason: v.reason,
      },
    })
    return
  }
  const startChanged = v.date !== initial.date || start !== initial.start
  const endChanged = startChanged || end !== initial.end
  await updateEntryFn({
    data: {
      id: entry.id,
      startAt: startChanged ? startAt : undefined,
      endAt: endChanged && endAt ? endAt : undefined,
      note: v.note !== entry.note ? v.note : undefined,
      reason: v.reason,
    },
  })
}

const SERVER_FIELDS: Record<string, keyof Values> = { startAt: "start", endAt: "end", reason: "reason" }

/** Server field errors mapped onto the form's fields, as `[field, message key]`. */
function serverEntryErrors(err: unknown): [keyof Values, string][] {
  return Object.entries(errorFields(err) ?? {}).flatMap(([k, code]): [keyof Values, string][] => {
    const name = SERVER_FIELDS[k]
    return name && typeof code === "string" ? [[name, `errors.fields.${code}`]] : []
  })
}

export function EntryDialog({
  open,
  onOpenChange,
  target,
  ctx,
  correction,
  onHistory,
  onRestore,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: EntryTarget
  ctx: EntryContext
  correction?: Correction
  onHistory: (entry: Entry) => void
  onRestore?: (entry: Entry, reason: string) => void
}) {
  const { t, tError, intl } = useI18n()
  const qc = useQueryClient()
  const entry = target.entry
  const initial = defaults(target, ctx)
  const lock = ctx.lockedMonths[initial.date.slice(0, 7)]
  const readOnly = Boolean(lock) || !ctx.canEdit || Boolean(entry?.deleted)
  const needsReason = (v: Values) => reasonNeeded(v, initial, ctx)
  // deleting always needs a reason: the field appears when Delete is pressed without one
  const [deleteRequested, setDeleteRequested] = useState(false)

  const form = useAppForm({
    defaultValues: initial,
    validators: {
      onChange: ({ value }) => {
        const fields = validateEntry(value, initial, ctx, entry)
        return Object.keys(fields).length ? { fields } : undefined
      },
    },
    onSubmit: async ({ value, formApi }) => {
      const failed = await failure(saveEntry(value, initial, ctx, entry))
      if (!failed) {
        await invalidateTimeData(qc)
        toast.success(t("common.saved"))
        onOpenChange(false)
        return
      }
      const fields = serverEntryErrors(failed.error)
      for (const [name, code] of fields)
        formApi.setFieldMeta(name, (m) => ({ ...m, isBlurred: true, errorMap: { ...m.errorMap, onSubmit: code } }))
      if (!fields.length) toast.error(tError(failed.error))
    },
  })

  const values = useStore(form.store, (s) => s.values)
  const submitting = useStore(form.store, (s) => s.isSubmitting)

  /** False (and the reason field focused) while a required reason is missing. */
  const reasonGiven = () => {
    const v = form.state.values
    if (!needsReason(v) || v.reason.trim()) return true
    form.setFieldMeta("reason", (m) => ({ ...m, isBlurred: true }))
    focusField(document.getElementById("entry-form"), "reason")
    return false
  }

  const restoreDeleted = useMutation({
    mutationFn: async (vars: { id: number; reason: string }) => {
      await restoreEntryFn({ data: vars })
      await invalidateTimeData(qc)
    },
    onError: (err) => toast.error(tError(err)),
  })
  const deletion = useMutation({
    mutationFn: async (vars: { id: number; reason: string }) => {
      await deleteEntryFn({ data: vars })
      await invalidateTimeData(qc)
    },
    onSuccess: (_, vars) => {
      onOpenChange(false)
      undoToast(t("time.deleted"), t("common.undo"), () => restoreDeleted.mutate(vars))
    },
    onError: (err) => toast.error(tError(err)),
  })
  const deleting = deletion.isPending
  const remove = () => {
    if (!entry) return
    if (!form.state.values.reason.trim()) {
      setDeleteRequested(true)
      form.setFieldMeta("reason", (m) => ({ ...m, isBlurred: true }))
      setTimeout(() => focusField(document.getElementById("entry-form"), "reason"), 0)
      return
    }
    deletion.mutate({ id: entry.id, reason: form.state.values.reason })
  }

  const restorable = Boolean(entry?.deleted && ctx.canEdit && !lock && onRestore)
  const title = readOnly ? t("time.entry") : entry ? t("time.edit_entry") : t("time.add_entry")
  const reasonField = (
    <form.AppField name="reason">
      {(f) => (
        <f.TextareaField
          label={t("time.reason_required")}
          maxLength={500}
          placeholder={t("time.reason_placeholder")}
          description={
            deleteRequested
              ? t("time.reason_delete_help")
              : ctx.self
                ? undefined
                : t("time.reason_other_help", { name: ctx.owner.name })
          }
        />
      )}
    </form.AppField>
  )
  const nextDay =
    values.mode === "times" && values.start && values.end && hhmmToMin(values.end) < hhmmToMin(values.start)
  const liveMinutes =
    values.mode === "times" && values.start && values.end
      ? (hhmmToMin(values.end) - hhmmToMin(values.start) + 1440) % 1440
      : null
  const otherZone = entry && entry.tz !== ctx.owner.timezone

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footerStart={
        entry ? (
          <>
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                intent="negative"
                className="text-destructive"
                onClick={remove}
                disabled={deleting}
              >
                {deleting ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
                {t("common.delete")}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => onHistory(entry)}>
              <History data-icon="inline-start" />
              {t("time.history")}
            </Button>
          </>
        ) : null
      }
      footer={
        <>
          {entry && restorable ? (
            <Button
              type="button"
              variant="outline"
              intent="positive"
              onClick={() => {
                if (!reasonGiven()) return
                onRestore?.(entry, form.state.values.reason)
                onOpenChange(false)
              }}
            >
              <RotateCcw data-icon="inline-start" />
              {t("time.restore")}
            </Button>
          ) : null}
          {readOnly ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          ) : (
            <Button type="submit" form="entry-form" disabled={submitting}>
              {submitting ? <Spinner data-icon="inline-start" /> : null}
              {t("common.save")}
            </Button>
          )}
        </>
      }
    >
      <FormRoot form={form} id="entry-form">
        {lock ? (
          <Notice icon={Lock} tone="positive">
            {t("time.locked_editor", { name: lock.signedBy ?? "?", date: fmtDay(lock.signedAt.slice(0, 10), intl) })}
          </Notice>
        ) : null}
        {entry?.corrected && correction ? (
          <Notice
            icon={UserPen}
            tone="warning"
            action={
              ctx.self ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onHistory(entry)}>
                  {t("time.dispute")}
                </Button>
              ) : null
            }
          >
            <span className="font-medium">{t("time.changed_by", { name: correction.by })}</span>
            {correction.reason ? <span className="text-muted-foreground"> · “{correction.reason}”</span> : null}
          </Notice>
        ) : null}

        <fieldset disabled={readOnly} className="flex flex-col gap-5">
          {ctx.owner.recordingMode === "simplified" && !entry?.running ? (
            <form.Field name="mode">
              {(f) => (
                <Segmented
                  value={f.state.value}
                  onValueChange={f.handleChange}
                  aria-label={t("time.entry_mode")}
                  options={[
                    { value: "total", label: t("time.daily_total") },
                    { value: "times", label: t("time.from_to") },
                  ]}
                />
              )}
            </form.Field>
          ) : null}

          <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-[1.6fr_1fr_1fr_auto]">
            <div className="col-span-2 sm:col-span-1">
              <form.AppField name="date">
                {(f) => <f.DateField label={t("common.date")} max={ctx.today} />}
              </form.AppField>
            </div>
            {values.mode === "times" ? (
              <>
                <form.AppField name="start">{() => <TimeField label={t("time.start")} />}</form.AppField>
                <form.AppField name="end">
                  {() => (
                    <TimeField
                      label={t("time.end")}
                      from={values.start}
                      description={
                        nextDay ? t("time.next_day") : entry?.running && !values.end ? t("time.running") : undefined
                      }
                    />
                  )}
                </form.AppField>
                <div className="hidden flex-col gap-2 sm:flex">
                  <span className="text-sm font-medium" aria-hidden>
                    &nbsp;
                  </span>
                  <output
                    className="flex h-9 min-w-12 items-center justify-end text-sm font-medium tabular text-muted-foreground"
                    aria-label={t("time.duration")}
                  >
                    {liveMinutes != null ? fmtMinutes(liveMinutes) : "–"}
                  </output>
                </div>
              </>
            ) : (
              <form.AppField name="total">
                {(f) => (
                  <f.TextField
                    label={t("time.duration")}
                    inputMode="decimal"
                    placeholder="7:30"
                    className="tabular"
                    description={t("time.total_help")}
                  />
                )}
              </form.AppField>
            )}
          </div>
          {otherZone ? (
            <p className="-mt-3 text-xs text-muted-foreground">{t("time.tz_hint", { tz: ctx.owner.timezone })}</p>
          ) : null}

          <form.AppField name="note">
            {(f) => (
              <f.TextareaField
                label={t("common.note")}
                maxLength={500}
                placeholder={t("time.note_placeholder")}
                className="min-h-32"
              />
            )}
          </form.AppField>

          {!readOnly && (needsReason(values) || deleteRequested) ? reasonField : null}
        </fieldset>
        {/* a deleted entry is read-only, but restoring it may need a reason too */}
        {restorable && needsReason(values) ? reasonField : null}
      </FormRoot>
    </ResponsiveDialog>
  )
}
