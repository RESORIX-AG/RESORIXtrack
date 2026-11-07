/**
 * Request, report sick, record (for someone else) and change an absence. Half days follow the service:
 * a single day is full, morning or afternoon; a longer absence may start in the afternoon and end at noon.
 * A live preview shows the working days covered and the vacation left afterwards.
 */
import { useStore } from "@tanstack/react-form"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Paperclip } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { AbsenceCalendar } from "@/components/app/absence-calendar"
import { type CalendarCell, cellsFrom } from "@/components/app/absence-calendar-cells"
import { ResponsiveDialog } from "@/components/app/responsive-dialog"
import { Segmented } from "@/components/app/segmented"
import { ColorDot } from "@/components/app/status-badge"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { FilePicker } from "@/components/ui/file-picker"
import { Spinner } from "@/components/ui/spinner"
import { addDaysStr, addMonthsStr, fmtDays, fmtMonth } from "@/lib/format"

import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { AbsenceDto } from "@/server/services/absences"
import {
  absencePreviewQuery,
  absenceTypesQuery,
  calendarDaysQuery,
  createAbsenceFn,
  reportSickTodayFn,
  updateAbsenceFn,
} from "./api"
import { serverFieldErrors, uploadDocument, useRefreshAbsences } from "./hooks"
import { ATTACHMENT_ACCEPT, HALVES, type Half, nextRange, nextWeekday, normalizeHalves, shortLabel } from "./lib"

export type RequestMode =
  | { kind: "new"; type?: string; start?: string }
  | { kind: "sick" }
  | { kind: "edit"; absence: AbsenceDto }

export interface RequestContext {
  today: string
  sickBackdateDays: number
  sickMaxDays: number
  /** the person the absence is for; null = the signed-in person */
  userId?: number | null
  self: boolean
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.fields.required")

export function RequestSheet({
  open,
  onOpenChange,
  mode,
  ctx,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: RequestMode
  ctx: RequestContext
}) {
  const i = useI18n()
  const { t } = i
  // remount the form for each opening so defaults follow the mode
  const [key, setKey] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setKey((k) => k + 1)
  }
  const title =
    mode.kind === "edit" ? t("absences.edit") : mode.kind === "sick" ? t("absences.report_sick") : t("absences.request")
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title}>
      <RequestForm key={key} mode={mode} ctx={ctx} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  )
}

interface RequestValues {
  type: string
  startDate: string
  endDate: string
  startHalf: Half
  endHalf: Half
  note: string
  reason: string
}

/** Saves the request (and its document); resolves to the success message key. */
async function saveRequest({
  value,
  editing,
  ctx,
  mode,
  file,
  onUploadError,
}: {
  value: RequestValues
  editing: AbsenceDto | null
  ctx: RequestContext
  mode: RequestMode
  file: File | null
  onUploadError: (err: unknown) => void
}): Promise<string> {
  const halves = normalizeHalves(value.startDate, value.endDate, value.startHalf, value.endHalf)
  if (editing) {
    await updateAbsenceFn({
      data: {
        id: editing.id,
        patch: {
          startDate: value.startDate,
          endDate: value.endDate,
          ...halves,
          note: value.note,
          reason: value.reason,
        },
      },
    })
    return "common.saved"
  }
  // sick for the whole of today also stops a running clock
  const sickToday =
    ctx.self &&
    mode.kind === "sick" &&
    value.startDate === ctx.today &&
    value.endDate === ctx.today &&
    halves.startHalf === "full"
  const created = sickToday
    ? await reportSickTodayFn({ data: { note: value.note } })
    : await createAbsenceFn({
        data: {
          userId: ctx.self ? null : ctx.userId,
          type: value.type,
          startDate: value.startDate,
          endDate: value.endDate,
          ...halves,
          note: value.note,
        },
      })
  if (file && created.permissions?.attach) await uploadDocument(created.id, file).catch(onUploadError)
  return created.status === "pending" ? "absences.requested_ok" : "absences.recorded_ok"
}

function RequestForm({ mode, ctx, onDone }: { mode: RequestMode; ctx: RequestContext; onDone: () => void }) {
  const absFileId = useId()
  const endAmId = useId()
  const halfLabelId = useId()
  const startPmId = useId()
  const i = useI18n()
  const { t, tError, absenceLabel } = i
  const refresh = useRefreshAbsences()
  const types = useQuery(absenceTypesQuery).data
  const editing = mode.kind === "edit" ? mode.absence : null
  const sick = mode.kind === "sick" || (editing?.type.category === "sick" && ctx.self)
  const [file, setFile] = useState<File | null>(null)

  const requestable = new Set(types?.requestable)
  const choices = (types?.all ?? []).filter(
    (x) => x.isActive && (!ctx.self || requestable.has(x.id)) && (mode.kind !== "sick" || x.category === "sick"),
  )
  const defaultType =
    editing?.type.key ?? (mode.kind === "new" ? mode.type : undefined) ?? (mode.kind === "sick" ? "sick" : "vacation")
  const defaultStart =
    editing?.startDate ??
    (mode.kind === "new" && mode.start ? mode.start : mode.kind === "sick" ? ctx.today : nextWeekday(ctx.today))
  // a sick report's start is fixed once recorded (only the lead may move it)
  const lockStart = Boolean(editing && sick && editing.status === "approved" && ctx.self)
  const needsReason = Boolean(editing && !ctx.self)

  const schema = z
    .object({
      type: z.string().min(1, "errors.fields.required"),
      startDate: day,
      endDate: day,
      startHalf: z.enum(["full", "am", "pm"]),
      endHalf: z.enum(["full", "am", "pm"]),
      note: z.string().max(1000, "errors.fields.too_long"),
      reason: z.string().max(1000, "errors.fields.too_long"),
    })
    .superRefine((v, c) => {
      if (v.endDate && v.startDate && v.endDate < v.startDate)
        c.addIssue({ code: "custom", path: ["endDate"], message: "errors.fields.before_start" })
      if (needsReason && !v.reason.trim())
        c.addIssue({ code: "custom", path: ["reason"], message: "errors.fields.required" })
      if (sick && ctx.self && !lockStart) {
        if (v.startDate > ctx.today)
          c.addIssue({ code: "custom", path: ["startDate"], message: "errors.fields.future" })
        else if (v.startDate < addDaysStr(ctx.today, -ctx.sickBackdateDays))
          c.addIssue({ code: "custom", path: ["startDate"], message: "errors.fields.too_old" })
      }
      if (sick && ctx.self && v.endDate >= v.startDate && v.endDate > addDaysStr(v.startDate, ctx.sickMaxDays - 1))
        c.addIssue({ code: "custom", path: ["endDate"], message: "errors.fields.too_long" })
    })

  const form = useAppForm({
    defaultValues: {
      type: defaultType,
      startDate: defaultStart,
      endDate: editing?.endDate ?? defaultStart,
      startHalf: editing?.startHalf ?? "full",
      endHalf: editing?.endHalf ?? "full",
      note: editing?.note ?? "",
      reason: "",
    },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      const outcome = await saveRequest({
        value,
        editing,
        ctx,
        mode,
        file,
        onUploadError: (e) => toast.error(tError(e)),
      })
        .then(async (message) => {
          await refresh()
          return { message, error: null }
        })
        .catch((error: unknown) => ({ message: null, error }))
      if (outcome.message) {
        toast.success(t(outcome.message))
        onDone()
        return
      }
      const mapped = serverFieldErrors(outcome.error)
      if (!mapped || !applyServerErrors(form, mapped)) toast.error(tError(outcome.error))
    },
  })

  const v = useStore(form.store, (s) => s.values)
  const selected = choices.find((x) => x.key === v.type) ?? types?.all.find((x) => x.key === v.type)
  const single = v.startDate === v.endDate
  const halves = normalizeHalves(v.startDate, v.endDate, v.startHalf, v.endHalf)
  const validRange =
    /^\d{4}-\d{2}-\d{2}$/.test(v.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(v.endDate) && v.endDate >= v.startDate
  const params = {
    userId: ctx.self ? null : ctx.userId,
    type: v.type,
    startDate: v.startDate,
    endDate: v.endDate,
    ...halves,
  }
  const [debounced, setDebounced] = useState(params)
  const paramsKey = JSON.stringify(params)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(JSON.parse(paramsKey)), 200)
    return () => clearTimeout(id)
  }, [paramsKey])
  const preview = useQuery({
    ...absencePreviewQuery(debounced),
    enabled: validRange && Boolean(debounced.type),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const setRange = (start: string, end: string) => {
    if (!lockStart) form.setFieldValue("startDate", start)
    form.setFieldValue("endDate", lockStart && end < v.startDate ? v.startDate : end)
  }

  return (
    <form.AppForm>
      <FormRoot form={form}>
        {mode.kind === "new" && choices.length > 1 ? (
          <form.AppField name="type">
            {(f) => (
              <f.ComboboxField
                label={t("absences.type")}
                options={choices.map((x) => ({
                  value: x.key,
                  label: absenceLabel(x),
                  icon: <ColorDot color={x.color} />,
                }))}
              />
            )}
          </form.AppField>
        ) : selected ? (
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="size-2.5 rounded-full" style={{ background: selected.color }} aria-hidden />
            {absenceLabel(selected)}
          </p>
        ) : null}

        {!sick ? (
          <RangePicker ctx={ctx} start={v.startDate} end={v.endDate} excludeId={editing?.id} onChange={setRange} />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <form.AppField
            name="startDate"
            listeners={{
              onChange: ({ value }) => {
                if (value && form.getFieldValue("endDate") < value) form.setFieldValue("endDate", value)
              },
            }}
          >
            {(f) => (
              <f.DateField
                label={t("absences.start")}
                disabled={lockStart}
                min={sick && ctx.self ? addDaysStr(ctx.today, -ctx.sickBackdateDays) : undefined}
                max={sick && ctx.self ? ctx.today : undefined}
                description={
                  sick && ctx.self && !lockStart ? t("absences.sick_limit", { count: ctx.sickBackdateDays }) : undefined
                }
              />
            )}
          </form.AppField>
          <form.AppField name="endDate">
            {(f) => <f.DateField label={t("absences.end")} min={v.startDate} />}
          </form.AppField>
        </div>

        {single ? (
          <form.Field name="startHalf">
            {(f) => (
              <Field>
                <FieldLabel id={halfLabelId}>{t("absences.single_day")}</FieldLabel>
                <Segmented
                  aria-labelledby={halfLabelId}
                  value={f.state.value}
                  onValueChange={f.handleChange}
                  fill
                  options={HALVES.map((h) => ({ value: h, label: t(`absences.half.${h}`) }))}
                />
              </Field>
            )}
          </form.Field>
        ) : (
          <div className="flex flex-col gap-3">
            <form.Field name="startHalf">
              {(f) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id={startPmId}
                    checked={f.state.value === "pm"}
                    onCheckedChange={(c) => f.handleChange(c ? "pm" : "full")}
                  />
                  <FieldLabel htmlFor={startPmId} className="font-normal">
                    {t("absences.half.start_pm")}
                  </FieldLabel>
                </Field>
              )}
            </form.Field>
            <form.Field name="endHalf">
              {(f) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id={endAmId}
                    checked={f.state.value === "am"}
                    onCheckedChange={(c) => f.handleChange(c ? "am" : "full")}
                  />
                  <FieldLabel htmlFor={endAmId} className="font-normal">
                    {t("absences.half.end_am")}
                  </FieldLabel>
                </Field>
              )}
            </form.Field>
          </div>
        )}

        <form.AppField name="note">
          {(f) => (
            <f.TextareaField label={t("absences.note")} placeholder={t("absences.note_placeholder")} maxLength={1000} />
          )}
        </form.AppField>

        {needsReason ? (
          <form.AppField name="reason">
            {(f) => (
              <f.TextareaField
                label={t("time.reason_required")}
                description={t("common.reason_required_help")}
                maxLength={1000}
              />
            )}
          </form.AppField>
        ) : null}

        {!editing && selected?.allowsAttachments ? (
          <Field>
            <FieldLabel htmlFor={absFileId}>{t("absences.attach")}</FieldLabel>
            <FilePicker id={absFileId} accept={ATTACHMENT_ACCEPT} file={file} onChange={setFile} />
            <FieldDescription>{t("absences.attach_help")}</FieldDescription>
          </Field>
        ) : null}

        <PreviewBox
          days={validRange ? preview.data?.days : undefined}
          vacationAfter={selected?.deductsVacation ? preview.data?.vacationAfter : undefined}
          loading={preview.isFetching && !preview.data}
          approval={ctx.self && !editing ? (selected?.requiresApproval ? "needs" : "none") : null}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <form.SubmitButton>
            {file ? <Paperclip data-icon="inline-start" /> : null}
            {editing
              ? t("common.save")
              : ctx.self && selected?.requiresApproval
                ? t("absences.submit")
                : t("absences.submit_record")}
          </form.SubmitButton>
        </div>
      </FormRoot>
    </form.AppForm>
  )
}

function PreviewBox({
  days,
  vacationAfter,
  loading,
  approval,
}: {
  days: number | undefined
  vacationAfter: number | undefined
  loading: boolean
  approval: "needs" | "none" | null
}) {
  const { t } = useI18n()
  const negative = vacationAfter != null && vacationAfter < 0
  return (
    <output
      aria-live="polite"
      className={cn(
        "flex min-h-16 flex-col justify-center gap-0.5 rounded-lg border bg-muted/50 px-3 py-2.5 text-sm",
        negative && "border-warning/40 bg-warning/12",
      )}
    >
      {loading ? (
        <Spinner />
      ) : days != null ? (
        <>
          <span className="font-semibold tabular">{t("absences.preview_days", { count: days, n: fmtDays(days) })}</span>
          {vacationAfter != null ? (
            <span className={cn("tabular", negative ? "text-warning" : "text-muted-foreground")}>
              {t("absences.preview_after", { n: fmtDays(vacationAfter) })}
              {negative ? ` · ${t("absences.preview_negative")}` : null}
            </span>
          ) : null}
          {approval ? (
            <span className="text-muted-foreground">
              {approval === "needs" ? t("absences.needs_approval") : t("absences.no_approval")}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">{t("absences.calendar_hint")}</span>
      )}
    </output>
  )
}

/** Month calendar to pick the period, with holidays and the person's other absences. */
function RangePicker({
  ctx,
  start,
  end,
  excludeId,
  onChange,
}: {
  ctx: RequestContext
  start: string
  end: string
  excludeId?: number
  onChange: (start: string, end: string) => void
}) {
  const { t, intl, absenceLabel } = useI18n()
  const [month, setMonth] = useState(() => (/^\d{4}-\d{2}/.test(start) ? start : ctx.today).slice(0, 7))
  const [anchor, setAnchor] = useState<string | null>(null)
  const year = month.slice(0, 4)
  const days = useQuery({
    ...calendarDaysQuery({ userId: ctx.self ? null : ctx.userId, from: `${year}-01-01`, to: `${year}-12-31` }),
    placeholderData: keepPreviousData,
  }).data
  const cells: Map<string, CalendarCell> = days
    ? cellsFrom(days, (a) =>
        a.id === excludeId
          ? null
          : {
              key: String(a.id),
              color: a.color,
              text: shortLabel(absenceLabel({ key: a.typeKey, label: a.label })),
              label: `${absenceLabel({ key: a.typeKey, label: a.label })}${a.status === "pending" ? ` (${t("absences.status.pending")})` : ""}`,
              pending: a.status === "pending",
              half: a.halves.length === 1 ? a.halves[0] : null,
            },
      )
    : new Map()
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" aria-live="polite">
          {fmtMonth(month, intl)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("common.previous")}
            onClick={() => setMonth(addMonthsStr(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("common.next_period")}
            onClick={() => setMonth(addMonthsStr(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <AbsenceCalendar
        month={month}
        days={cells}
        today={ctx.today}
        size="sm"
        selection={{ start, end }}
        onMonthChange={setMonth}
        onSelect={(d) => {
          const r = nextRange(anchor, d)
          setAnchor(r.anchor)
          onChange(r.start, r.end)
        }}
      />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {anchor ? t("absences.calendar_hint_end") : t("absences.calendar_hint")}
      </p>
    </div>
  )
}
