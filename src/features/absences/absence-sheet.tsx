/**
 * One absence: details, documents (upload, preview, download, remove), change history, change and cancel.
 * Cancelling runs at once with Undo when re-requesting gives the same state (pending requests, absences
 * without approval, no documents); otherwise it asks first, with a reason when it is someone else's.
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, ChevronRight, Download, FileText, Pencil, Trash2, Upload, X } from "lucide-react"
import { Fragment, type ReactNode, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/app/confirm"
import { ResponsiveDialog } from "@/components/app/responsive-dialog"
import { AbsenceStatusBadge, ColorDot } from "@/components/app/status-badge"
import { undoToast } from "@/components/app/undo-toast"
import { PendingButton } from "@/components/form/pending-button"
import { Button, ButtonLink } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { fmtDateTime, fmtDays } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { AbsenceDto, AttachmentDto } from "@/server/services/absences"
import {
  absenceHistoryQuery,
  absenceQuery,
  cancelAbsenceFn,
  createAbsenceFn,
  decideAbsenceFn,
  deleteAttachmentFn,
} from "./api"
import { uploadDocument, useRefreshAbsences } from "./hooks"
import { ATTACHMENT_ACCEPT, fmtBytes, formatSpan, isPreviewableImage } from "./lib"

export function AbsenceSheet({
  absence: initial,
  open,
  onOpenChange,
  onEdit,
  vacationLeftAfter,
}: {
  absence: AbsenceDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (a: AbsenceDto) => void
  /** shown for pending vacation requests when the caller knows it (approvals) */
  vacationLeftAfter?: number | null
}) {
  const i = useI18n()
  const { t, absenceLabel } = i
  const me = useMe()
  const refresh = useRefreshAbsences()
  const [declining, setDeclining] = useState(false)
  const live = useQuery({
    ...absenceQuery(initial?.id ?? 0),
    enabled: open && Boolean(initial),
    initialData: initial ?? undefined,
  })
  const a = live.data ?? initial
  const p = a?.permissions ?? { cancel: false, decide: false, edit: false, attach: false }
  const decide = useMutation({
    mutationFn: (data: { id: number; approve: boolean; note: string }) => decideAbsenceFn({ data }),
    onSuccess: async (_, v) => {
      await refresh()
      toast.success(v.approve ? t("absences.approvals.approved_toast") : t("absences.approvals.rejected_toast"))
      onOpenChange(false)
    },
    onError: (err) => toast.error(i.tError(err)),
  })
  const canDecide = Boolean(a && p.decide && a.status === "pending")
  return (
    <>
      <ResponsiveDialog
        open={open && Boolean(a)}
        onOpenChange={onOpenChange}
        title={
          a ? (
            <span className="flex items-center gap-2">
              <ColorDot color={a.type.color} />
              {absenceLabel(a.type)}
            </span>
          ) : (
            ""
          )
        }
        description={a ? formatSpan(a, i, { year: true }) : undefined}
        meta={
          a ? (
            <>
              <AbsenceStatusBadge status={a.status} label={t(`absences.status.${a.status}`)} />
              <span className="text-sm text-muted-foreground tabular">
                {t("absences.n_days", { count: a.days, n: fmtDays(a.days) })}
              </span>
            </>
          ) : null
        }
        footerStart={
          a && p.cancel ? (
            <CancelButton a={a} self={a.user.id === me.id} onCancelled={() => onOpenChange(false)} />
          ) : null
        }
        footer={
          a && (p.edit || canDecide) ? (
            <>
              {p.edit ? (
                <Button variant="outline" onClick={() => onEdit(a)}>
                  <Pencil data-icon="inline-start" />
                  {t("absences.change")}
                </Button>
              ) : null}
              {canDecide ? (
                <>
                  <Button
                    variant="outline"
                    intent="negative"
                    disabled={decide.isPending}
                    onClick={() => setDeclining(true)}
                  >
                    <X data-icon="inline-start" />
                    {t("absences.approvals.reject")}
                  </Button>
                  <Button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: a.id, approve: true, note: "" })}
                  >
                    {decide.isPending ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                    {t("absences.approvals.approve")}
                  </Button>
                </>
              ) : null}
            </>
          ) : null
        }
      >
        {a ? <Details a={a} vacationLeftAfter={vacationLeftAfter} /> : null}
      </ResponsiveDialog>
      <RejectDialog
        ids={declining && a ? [a.id] : null}
        onClose={() => setDeclining(false)}
        onReject={(note) => {
          setDeclining(false)
          if (a) decide.mutate({ id: a.id, approve: false, note })
        }}
      />
    </>
  )
}

/** Muted label left, value right; rows without a value are left out. */
function DetailList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words whitespace-pre-wrap">{v}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function Details({ a, vacationLeftAfter }: { a: AbsenceDto; vacationLeftAfter?: number | null }) {
  const i = useI18n()
  const { t, absenceLabel } = i
  const me = useMe()
  const p = a.permissions ?? { cancel: false, decide: false, edit: false, attach: false }
  const at = (v: string | null) =>
    v ? fmtDateTime(v, { intl: i.intl, tz: me.timezone, hour12: me.timeFormat === "12h" }) : ""
  const byAt = (who: { name: string } | null, when: string | null) =>
    who ? (when ? t("absences.detail.by_at", { name: who.name, at: at(when) }) : who.name) : when ? at(when) : ""
  const decided = a.status === "approved" || a.status === "rejected"
  const rows: [string, ReactNode][] = [
    [t("absences.detail.person"), a.user.id !== me.id ? a.user.name : ""],
    [t("absences.type"), absenceLabel(a.type)],
    [t("absences.period"), formatSpan(a, i, { year: true })],
    [
      t("absences.detail.working_days"),
      <span key="days" className="tabular">
        {fmtDays(a.days)}
      </span>,
    ],
    [
      t("absences.detail.vacation_left"),
      vacationLeftAfter != null && a.status === "pending" ? (
        <span key="left" className="tabular">
          {fmtDays(vacationLeftAfter)}
        </span>
      ) : (
        ""
      ),
    ],
    [t("absences.detail.requested"), byAt(a.requestedBy, a.createdAt)],
    [t("absences.detail.decided"), decided ? byAt(a.decidedBy, a.decidedAt) : ""],
    [t("absences.detail.decision_note"), a.decisionNote ?? ""],
    [t("absences.detail.cancelled"), a.status === "cancelled" ? byAt(a.cancelledBy, a.cancelledAt) : ""],
    [t("absences.detail.cancel_reason"), a.status === "cancelled" ? (a.cancelReason ?? "") : ""],
    [t("absences.note"), a.note ?? ""],
  ]
  return (
    <div className="flex flex-col gap-6">
      <DetailList rows={rows.filter(([, v]) => v !== "" && v != null)} />
      {a.type.allowsAttachments || a.attachments.length ? <Documents a={a} canAttach={p.attach} /> : null}
      <HistorySection id={a.id} />
    </div>
  )
}

function CancelButton({ a, self, onCancelled }: { a: AbsenceDto; self: boolean; onCancelled: () => void }) {
  const cancelReasonId = useId()
  const { t, tError } = useI18n()
  const refresh = useRefreshAbsences()
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState("")
  const reversible = self && (a.status === "pending" || !a.type.requiresApproval) && a.attachments.length === 0

  const cancel = useMutation({
    mutationFn: (why: string) => cancelAbsenceFn({ data: { id: a.id, reason: why } }),
    onSuccess: async (_, why) => {
      await refresh()
      if (reversible && !why) undoToast(t("absences.cancelled_ok"), t("common.undo"), () => restore.mutate())
      else toast.success(t("absences.cancelled_ok"))
      onCancelled()
    },
    onError: (err) => toast.error(tError(err)),
  })
  const restore = useMutation({
    mutationFn: async () => {
      await createAbsenceFn({
        data: {
          type: a.type.key,
          startDate: a.startDate,
          endDate: a.endDate,
          startHalf: a.startHalf,
          endHalf: a.endHalf,
          note: a.note,
        },
      })
      await refresh()
    },
    onSuccess: () => toast.success(t("absences.restored_ok")),
    onError: (err) => toast.error(tError(err)),
  })
  const busy = cancel.isPending

  return (
    <>
      <Button
        variant="ghost"
        intent="negative"
        className="text-destructive"
        disabled={busy}
        onClick={() => (reversible ? cancel.mutate("") : setConfirm(true))}
      >
        {busy ? <Spinner data-icon="inline-start" /> : <X data-icon="inline-start" />}
        {t("absences.cancel")}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => {
          setConfirm(o)
          if (!o) setReason("")
        }}
        title={t("absences.cancel_confirm")}
        description={self ? t("absences.cancel_approved_help") : t("absences.cancel_manager_help")}
        confirmLabel={t("absences.cancel")}
        onConfirm={() => {
          if (!self && !reason.trim()) {
            toast.error(t("errors.fields.required"))
            throw new Error("reason required")
          }
          return cancel.mutateAsync(reason.trim())
        }}
      >
        {!self ? (
          <Field>
            <FieldLabel htmlFor={cancelReasonId}>{t("common.reason")}</FieldLabel>
            <Textarea
              id={cancelReasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={2}
            />
          </Field>
        ) : null}
      </ConfirmDialog>
    </>
  )
}

function Documents({ a, canAttach }: { a: AbsenceDto; canAttach: boolean }) {
  const docsTitleId = useId()
  const { t, tError } = useI18n()
  const refresh = useRefreshAbsences()
  const input = useRef<HTMLInputElement>(null)
  const [remove, setRemove] = useState<AttachmentDto | null>(null)
  const [preview, setPreview] = useState<AttachmentDto | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => {
      await uploadDocument(a.id, file)
      await refresh()
    },
    onSuccess: () => toast.success(t("absences.uploaded_ok")),
    onError: (err) => toast.error(tError(err)),
  })
  const uploading = upload.isPending
  const removeAttachment = useMutation({
    mutationFn: async (id: number) => {
      await deleteAttachmentFn({ data: { id, reason: "" } })
      await refresh()
    },
    onSuccess: () => toast.success(t("absences.removed_ok")),
    onError: (err) => toast.error(tError(err)),
  })

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby={docsTitleId}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={docsTitleId} className="text-sm font-semibold">
          {t("absences.attachments")}
        </h3>
        {canAttach ? (
          <>
            <input
              ref={input}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload.mutate(f)
                e.target.value = ""
              }}
            />
            <Button
              variant="outline"
              disabled={uploading}
              onClick={() => input.current?.click()}
              title={t("absences.attach_help")}
            >
              {uploading ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
              {t("absences.attach")}
            </Button>
          </>
        ) : null}
      </div>
      {a.attachments.length ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {a.attachments.map((f) => {
            const image = isPreviewableImage(f.contentType)
            const inline = `${f.url}?inline=1`
            return (
              <li key={f.id} className="flex items-center gap-3 p-2">
                {image ? (
                  <button
                    type="button"
                    onClick={() => setPreview(f)}
                    className="size-10 shrink-0 overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${t("absences.preview")}: ${f.filename}`}
                  >
                    <img src={inline} alt="" className="size-full object-cover" loading="lazy" />
                  </button>
                ) : (
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                    aria-hidden
                  >
                    <FileText className="size-4" />
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  {image ? (
                    <button
                      type="button"
                      onClick={() => setPreview(f)}
                      className="truncate text-left text-sm font-medium hover:underline"
                    >
                      {f.filename}
                    </button>
                  ) : (
                    <a
                      href={inline}
                      target="_blank"
                      rel="noopener"
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {f.filename}
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground tabular">{fmtBytes(f.size)}</span>
                </div>
                <ButtonLink
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("common.download")}: ${f.filename}`}
                  href={f.url}
                  download
                >
                  <Download />
                </ButtonLink>
                {canAttach ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    intent="negative"
                    aria-label={`${t("absences.delete_attachment")}: ${f.filename}`}
                    onClick={() => setRemove(f)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("absences.no_documents")}</p>
      )}
      <ConfirmDialog
        open={Boolean(remove)}
        onOpenChange={(o) => !o && setRemove(null)}
        title={t("absences.delete_attachment_title", { name: remove?.filename ?? "" })}
        description={t("absences.delete_attachment_message")}
        confirmLabel={t("absences.delete_attachment")}
        onConfirm={() => (remove ? removeAttachment.mutateAsync(remove.id) : undefined)}
      />
      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[90dvh] gap-3 p-3 shadow-overlay sm:max-w-3xl">
          <DialogTitle className="truncate pr-10 text-sm">{preview?.filename}</DialogTitle>
          <DialogDescription className="sr-only">{t("absences.preview")}</DialogDescription>
          {preview ? (
            <img
              src={`${preview.url}?inline=1`}
              alt={preview.filename}
              className="max-h-[75dvh] w-full rounded-lg object-contain"
            />
          ) : null}
          {preview ? (
            <div className="flex justify-end">
              <ButtonLink variant="outline" href={preview.url} download>
                <Download data-icon="inline-start" />
                {t("common.download")}
              </ButtonLink>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

const FIELDS = ["start_date", "end_date", "start_half", "end_half", "note"] as const

function HistorySection({ id }: { id: number }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3 border-t pt-4">
      <CollapsibleTrigger className="group/history flex items-center gap-2 self-start rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          className="size-4 text-muted-foreground transition-transform duration-150 group-aria-expanded/history:rotate-90"
          aria-hidden
        />
        {t("absences.history")}
      </CollapsibleTrigger>
      <CollapsibleContent>{open ? <HistoryList id={id} /> : null}</CollapsibleContent>
    </Collapsible>
  )
}

function HistoryList({ id }: { id: number }) {
  const i = useI18n()
  const { t } = i
  const me = useMe()
  const q = useQuery(absenceHistoryQuery(id))
  if (q.isPending) return <Skeleton className="h-16 w-full" />
  const rows = q.data ?? []
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t("absences.history_empty")}</p>
  const fmt = (k: string, raw: unknown) => {
    const v = typeof raw === "string" || typeof raw === "number" ? String(raw) : ""
    if (v === "") return "–"
    if (k.endsWith("_half")) return t(`absences.half.${v}`)
    if (k.endsWith("_date")) return formatSpan({ startDate: v, endDate: v, startHalf: "full", endHalf: "full" }, i)
    return v
  }
  return (
    <ol className="flex flex-col gap-3 border-l pl-4">
      {rows.map((r) => {
        const doc = r.entity === "attachment"
        const action = doc
          ? t(`absences.action.doc_${r.action === "create" ? "create" : "delete"}`, {
              name: fileName(r.after ?? r.before),
            })
          : t(`absences.action.${r.action}`)
        return (
          <li key={`${r.entity}-${r.id}`} className="flex flex-col gap-0.5 text-sm">
            <span className="font-medium">{action}</span>
            <span className="text-xs text-muted-foreground">
              {r.actor?.name || t("common.unknown")} ·{" "}
              {fmtDateTime(r.at, { intl: i.intl, tz: me.timezone, hour12: me.timeFormat === "12h" })}
            </span>
            {!doc && r.action === "update" && r.before && r.after ? (
              <span className="flex flex-col text-xs">
                {r.changed
                  .filter((k): k is (typeof FIELDS)[number] => (FIELDS as readonly string[]).includes(k))
                  .map((k) => (
                    <span key={k}>
                      <span className="text-muted-foreground">{t(`absences.field.${k}`)}: </span>
                      <del className="text-muted-foreground">{fmt(k, r.before?.[k])}</del> →{" "}
                      <ins className="no-underline">{fmt(k, r.after?.[k])}</ins>
                    </span>
                  ))}
              </span>
            ) : null}
            {r.reason ? <span className="text-xs">“{r.reason}”</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

function fileName(snap: Record<string, unknown> | null | undefined): string {
  const f = snap?.filename
  return typeof f === "string" ? f : ""
}

const formText = (data: FormData, name: string) => {
  const v = data.get(name)
  return typeof v === "string" ? v.trim() : ""
}

/** Decline one or several requests with an optional note for the person. */
export function RejectDialog({
  ids,
  onClose,
  onReject,
}: {
  ids: number[] | null
  onClose: () => void
  onReject: (note: string) => void
}) {
  const noteId = useId()
  const { t } = useI18n()
  const n = ids?.length ?? 0
  return (
    <ResponsiveDialog
      open={ids !== null}
      onOpenChange={(o) => !o && onClose()}
      variant="dialog"
      title={n > 1 ? t("absences.approvals.reject_title_n", { count: n }) : t("absences.approvals.reject_title")}
      action={(data) => onReject(formText(data, "note"))}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <PendingButton variant="destructive" icon={<X data-icon="inline-start" />}>
            {t("absences.approvals.reject")}
          </PendingButton>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor={noteId}>{t("absences.approvals.decision_note")}</FieldLabel>
        <Textarea id={noteId} name="note" maxLength={1000} />
        <FieldDescription>{t("absences.approvals.decision_note_help")}</FieldDescription>
      </Field>
    </ResponsiveDialog>
  )
}
