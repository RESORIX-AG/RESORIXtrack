/**
 * Work log of a week: a strip of days with their coverage and the selected day's items (project or
 * customer reference, duration or from–to, note). When the company requires it, each day must describe
 * a share of the worked time; the requirement status shows per day. Inline add/edit; delete with Undo.
 */
import { useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Pencil, Plus, Trash2 } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { Section } from "@/components/app/page"
import { Segmented } from "@/components/app/segmented"
import { ColorDot } from "@/components/app/status-badge"
import { undoToast } from "@/components/app/undo-toast"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { failure } from "@/lib/attempt"
import { fmtDayLong, fmtMinutes, fmtWeekdayShort } from "@/lib/format"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { addWorklogFn, customerRefsQuery, deleteWorklogFn, projectsQuery, updateWorklogFn } from "../worklog/api"
import type { PeriodView } from "./api"
import type { Day } from "./entry-dialog"
import { invalidateTimeData } from "./invalidate"
import { fmtClockTime, hhmmToMin, parseDuration } from "./lib"
import { TimeField } from "./time-input"

export type WorklogItem = PeriodView["worklog"]["items"][number]
type Config = PeriodView["worklog"]["config"]

/** Coverage chip of a day: described share of the worked time. */
function Coverage({ day }: { day: Day }) {
  const { t } = useI18n()
  if (day.workedMin <= 0) return <span className="text-xs text-muted-foreground">–</span>
  const pct = Math.min(100, Math.round((day.worklogMin / day.workedMin) * 100))
  return (
    <span
      className={cn(
        "rounded-md px-1.5 text-xs font-medium whitespace-nowrap tabular",
        !day.worklogOk
          ? "bg-warning/14 text-warning"
          : pct >= 99 || day.worklogRequiredMin > 0
            ? "bg-positive/12 text-positive"
            : "bg-muted text-muted-foreground",
      )}
      title={t("worklog.coverage", { done: fmtMinutes(day.worklogMin), worked: fmtMinutes(day.workedMin) })}
    >
      {pct} %
    </span>
  )
}

export function WorklogWeek({ view, initialDay }: { view: PeriodView; initialDay?: string }) {
  const { t, intl } = useI18n()
  const cfg = view.worklog.config
  const pick = () =>
    (initialDay && view.days.find((d) => d.date === initialDay)?.date) ??
    view.days.find((d) => d.date === view.today)?.date ??
    view.days.findLast((d) => d.workedMin > 0)?.date ??
    view.days[0]?.date
  const [selected, setSelected] = useState(pick)
  const [period, setPeriod] = useState(view.from)
  if (period !== view.from) {
    setPeriod(view.from)
    setSelected(pick())
  }
  if (cfg.mode === "off") return null
  const day = view.days.find((d) => d.date === selected) ?? view.days[0]
  if (!day) return null
  const items = view.worklog.items.filter((w) => w.date === day.date && !w.isDeleted)
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden />
          {t("worklog.title")}
        </span>
      }
      description={cfg.mode === "required" ? t("worklog.sub_required", { percent: cfg.percent }) : undefined}
    >
      <div id="worklog" className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t("worklog.title")}>
          {view.days.map((d) => (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={d.date === day.date}
              disabled={d.isFuture}
              onClick={() => setSelected(d.date)}
              className={cn(
                "flex min-w-16 flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-sm transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40",
                d.date === day.date ? "border-primary bg-brand-soft" : "border-transparent bg-muted/40",
              )}
            >
              <span className={cn("text-xs font-medium", d.date === view.today && "text-primary")}>
                {fmtWeekdayShort(d.date, intl)} {Number(d.date.slice(8))}
              </span>
              <span className="font-semibold tabular">{d.workedMin > 0 ? fmtMinutes(d.workedMin) : "–"}</span>
              <Coverage day={d} />
            </button>
          ))}
        </div>
        <DayWorklog view={view} day={day} items={items} cfg={cfg} key={day.date} />
      </div>
    </Section>
  )
}

export function DayWorklog({
  view,
  day,
  items,
  cfg,
  heading = true,
}: {
  view: PeriodView
  day: Day
  items: WorklogItem[]
  cfg: Config
  heading?: boolean
}) {
  const { t, tError, intl } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<WorklogItem | "new" | null>(null)
  const self = view.user.id === me.id
  const hour12 = me.timeFormat === "12h"
  const locked = Boolean(view.lockedMonths[day.date.slice(0, 7)])
  const editable = view.canEdit && !locked && !day.isFuture
  const described = items.reduce((a, w) => a + w.minutes, 0)
  const required = day.worklogRequiredMin
  const pct = day.workedMin > 0 ? Math.min(100, (described / day.workedMin) * 100) : 0

  const readd = useMutation({
    mutationFn: async (w: WorklogItem) => {
      await addWorklogFn({
        data: {
          userId: self ? null : view.user.id,
          date: w.date,
          minutes: w.startTime ? null : w.minutes,
          startTime: w.startTime,
          endTime: w.endTime,
          projectId: w.projectId,
          customerRef: w.customerRef,
          note: w.note,
          reason: "",
        },
      })
      await invalidateTimeData(qc)
    },
    onError: (err) => toast.error(tError(err)),
  })
  const removal = useMutation({
    mutationFn: async (w: WorklogItem) => {
      await deleteWorklogFn({ data: { id: w.id, reason: "" } })
      await invalidateTimeData(qc)
    },
    onSuccess: (_, w) => undoToast(t("worklog.deleted"), t("common.undo"), () => readd.mutate(w)),
    onError: (err) => toast.error(tError(err)),
  })
  const remove = (w: WorklogItem) => removal.mutate(w)

  return (
    <div className="flex flex-col gap-3">
      {heading ? <h3 className="text-sm font-semibold">{fmtDayLong(day.date, intl)}</h3> : null}
      {day.workedMin > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground tabular">
              {t("worklog.coverage", { done: fmtMinutes(described), worked: fmtMinutes(day.workedMin) })}
            </span>
            {required > 0 ? (
              <span className={cn("font-medium", described >= required ? "text-positive" : "text-warning")}>
                {described >= required
                  ? t("worklog.requirement_met")
                  : t("worklog.requirement_missing", { missing: fmtMinutes(required - described) })}
              </span>
            ) : null}
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("worklog.no_work")}</p>
      )}
      {items.length ? (
        <ul className="flex flex-col">
          {items.map((w) =>
            editing !== "new" && editing?.id === w.id ? (
              <li key={w.id} className="py-2">
                <WorklogForm view={view} day={day} item={w} cfg={cfg} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={w.id} className="flex items-center gap-3 border-b py-2 last:border-b-0">
                <ColorDot color={w.project?.color ?? "var(--faint-foreground)"} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">
                    {w.startTime ? (
                      <span className="mr-2 text-muted-foreground tabular">
                        {fmtClockTime(w.startTime, hour12)}–{fmtClockTime(w.endTime, hour12)}
                      </span>
                    ) : null}
                    {w.project ? <span className="font-medium">{w.project.name}</span> : null}
                    {w.customerRef ? <span className="font-medium">{w.customerRef}</span> : null}
                    {(w.project || w.customerRef) && w.note ? <span className="text-muted-foreground"> · </span> : null}
                    <span className={w.project || w.customerRef ? "text-muted-foreground" : undefined}>{w.note}</span>
                  </p>
                </div>
                <span className="text-sm tabular">{fmtMinutes(w.minutes)}</span>
                {editable ? (
                  <span className="flex">
                    <Button variant="ghost" size="icon-sm" aria-label={t("common.edit")} onClick={() => setEditing(w)}>
                      <Pencil />
                    </Button>
                    <Button
                      intent="negative"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("common.delete")}
                      onClick={() => remove(w)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {editable && editing === "new" ? (
        <WorklogForm
          view={view}
          day={day}
          cfg={cfg}
          defaultMinutes={Math.max(0, Math.round(day.workedMin - described))}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {editable && editing === null && day.workedMin > 0 ? (
        <div>
          <Button variant="outline" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            {t("worklog.add")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const REF_KINDS = ["project", "customer"] as const
const AMOUNT_MODES = ["duration", "times"] as const

interface FormValues {
  ref: (typeof REF_KINDS)[number]
  projectId: string
  customerRef: string
  mode: (typeof AMOUNT_MODES)[number]
  duration: string
  start: string
  end: string
  note: string
  reason: string
}

const SERVER_FIELDS: Record<string, keyof FormValues> = {
  minutes: "duration",
  startTime: "start",
  endTime: "end",
  projectId: "projectId",
  customerRef: "customerRef",
  note: "note",
}

/** Server field errors mapped onto the form's fields, as `[field, message key]`. */
function serverWorklogErrors(err: unknown): [keyof FormValues, string][] {
  return Object.entries(errorFields(err) ?? {}).flatMap(([k, code]): [keyof FormValues, string][] => {
    const name = SERVER_FIELDS[k]
    return name && typeof code === "string" ? [[name, `errors.fields.${code}`]] : []
  })
}

function WorklogForm({
  view,
  day,
  item,
  cfg,
  defaultMinutes,
  onDone,
}: {
  view: PeriodView
  day: Day
  item?: WorklogItem
  cfg: Config
  defaultMinutes?: number
  onDone: () => void
}) {
  const wlProjectId = useId()
  const wlRefsId = useId()
  const { t, tError } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const self = view.user.id === me.id
  const projects = useQuery(projectsQuery(false))
  const refs = useQuery({ ...customerRefsQuery(), enabled: self })
  const list = projects.data?.items ?? []
  const options = item?.project && !list.some((p) => p.id === item.project?.id) ? [item.project, ...list] : list
  const projectItems: ComboboxOption[] = [
    { value: "none", label: t("worklog.no_project") },
    ...options.map((p) => ({
      value: String(p.id),
      label: p.name,
      icon: <ColorDot color={p.color} />,
      hint: [p.code, !p.isActive && t("worklog.inactive")].filter(Boolean).join(" · ") || undefined,
    })),
  ]

  const defaults: FormValues = {
    ref: item?.customerRef ? "customer" : "project",
    projectId: item?.projectId ? String(item.projectId) : "",
    customerRef: item?.customerRef ?? "",
    mode: item?.startTime ? "times" : "duration",
    duration: item ? fmtMinutes(item.minutes) : defaultMinutes ? fmtMinutes(defaultMinutes) : "",
    start: item?.startTime ?? "",
    end: item?.endTime ?? "",
    note: item?.note ?? "",
    reason: "",
  }
  const form = useAppForm({
    defaultValues: defaults,
    validators: {
      onChange: ({ value: v }) => {
        const f: Record<string, string> = {}
        if (v.mode === "duration") {
          const m = parseDuration(v.duration)
          if (m == null || m <= 0 || m > 1440) f.duration = "errors.fields.invalid"
        } else {
          if (!v.start) f.start = "errors.fields.required"
          if (!v.end) f.end = "errors.fields.required"
          else if (v.start && hhmmToMin(v.end) <= hhmmToMin(v.start)) f.end = "errors.fields.before_start"
        }
        if (cfg.projectRequired && (v.ref === "project" ? !v.projectId : !v.customerRef.trim())) {
          f[v.ref === "project" ? "projectId" : "customerRef"] = "worklog.project_or_customer_required"
        }
        if (!v.note.trim() && !v.projectId && !v.customerRef.trim()) f.note = "errors.fields.required"
        return Object.keys(f).length ? { fields: f } : undefined
      },
    },
    onSubmit: async ({ value: v, formApi }) => {
      const ref =
        v.ref === "customer"
          ? { projectId: null, customerRef: v.customerRef.trim() }
          : { projectId: v.projectId ? Number(v.projectId) : null, customerRef: "" }
      const time =
        v.mode === "times"
          ? { minutes: null, startTime: v.start, endTime: v.end }
          : { minutes: parseDuration(v.duration), startTime: null, endTime: null }
      const save = item
        ? updateWorklogFn({ data: { id: item.id, date: day.date, ...ref, ...time, note: v.note, reason: v.reason } })
        : addWorklogFn({
            data: {
              userId: self ? null : view.user.id,
              date: day.date,
              ...ref,
              ...time,
              note: v.note,
              reason: v.reason,
            },
          })
      const failed = await failure(save)
      if (!failed) {
        await invalidateTimeData(qc)
        toast.success(t("common.saved"))
        onDone()
        return
      }
      const fields = serverWorklogErrors(failed.error)
      for (const [name, code] of fields)
        formApi.setFieldMeta(name, (m) => ({ ...m, isBlurred: true, errorMap: { ...m.errorMap, onSubmit: code } }))
      if (!fields.length) toast.error(tError(failed.error))
    },
  })
  const v = useStore(form.store, (s) => s.values)
  const submitting = useStore(form.store, (s) => s.isSubmitting)
  const timed = v.mode === "times" && v.start && v.end ? hhmmToMin(v.end) - hhmmToMin(v.start) : 0

  return (
    <FormRoot form={form} className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <form.Field name="ref">
            {(f) => (
              <Segmented
                value={f.state.value}
                onValueChange={f.handleChange}
                aria-label={t("worklog.project")}
                options={[
                  { value: "project", label: t("worklog.project") },
                  { value: "customer", label: t("worklog.customer_short") },
                ]}
              />
            )}
          </form.Field>
          {v.ref === "project" ? (
            <form.Field name="projectId">
              {(f) => {
                const err = f.state.meta.isBlurred && f.state.meta.errors[0] ? t(f.state.meta.errors[0]) : ""
                return (
                  <Field data-invalid={err ? true : undefined}>
                    <FieldLabel htmlFor={wlProjectId} className="sr-only">
                      {t("worklog.project")}
                    </FieldLabel>
                    <Combobox
                      id={wlProjectId}
                      invalid={Boolean(err)}
                      options={projectItems}
                      value={f.state.value || "none"}
                      onChange={(x) => {
                        f.handleChange(x === "none" || x == null ? "" : x)
                        f.handleBlur()
                      }}
                    />
                    {err ? <FieldError>{err}</FieldError> : null}
                  </Field>
                )
              }}
            </form.Field>
          ) : (
            <form.AppField name="customerRef">
              {(f) => (
                <f.TextField
                  label={t("worklog.customer")}
                  srLabel
                  maxLength={60}
                  list={wlRefsId}
                  placeholder={t("worklog.customer_placeholder")}
                />
              )}
            </form.AppField>
          )}
          <datalist id={wlRefsId}>
            {(refs.data ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-2">
          <form.Field name="mode">
            {(f) => (
              <Segmented
                value={f.state.value}
                onValueChange={f.handleChange}
                aria-label={t("worklog.minutes")}
                options={[
                  { value: "duration", label: t("worklog.mode_duration") },
                  { value: "times", label: t("worklog.mode_times") },
                ]}
              />
            )}
          </form.Field>
          {v.mode === "duration" ? (
            <form.AppField name="duration">
              {(f) => (
                <f.TextField
                  label={t("worklog.minutes")}
                  srLabel
                  inputMode="decimal"
                  placeholder="1:30"
                  className="tabular"
                />
              )}
            </form.AppField>
          ) : (
            <div className="grid grid-cols-2 gap-2 [&_label]:sr-only">
              <form.AppField name="start">{() => <TimeField label={t("worklog.from")} />}</form.AppField>
              <form.AppField name="end">
                {() => (
                  <TimeField
                    label={t("worklog.to")}
                    from={v.start}
                    description={timed > 0 ? fmtMinutes(timed) : undefined}
                  />
                )}
              </form.AppField>
            </div>
          )}
        </div>
      </div>
      <form.AppField name="note">
        {(f) => (
          <f.TextareaField label={t("worklog.note")} maxLength={2000} placeholder={t("worklog.note_placeholder")} />
        )}
      </form.AppField>
      {!self ? (
        <form.AppField name="reason">
          {(f) => (
            <f.TextareaField label={`${t("common.reason")} (${t("common.optional").toLowerCase()})`} maxLength={500} />
          )}
        </form.AppField>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Spinner data-icon="inline-start" /> : null}
          {t("common.save")}
        </Button>
      </div>
    </FormRoot>
  )
}
