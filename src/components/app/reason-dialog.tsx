/**
 * A short decision that needs a logged reason (remove an adjustment, reopen a month). A native form Action:
 * the submit button shows its pending state, a missing reason is flagged at the field, a failure is toasted
 * and the dialog stays open with the text kept.
 */
import { type ReactNode, useId, useState } from "react"
import { toast } from "sonner"
import { PendingButton } from "@/components/form/pending-button"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/lib/i18n"
import { ResponsiveDialog } from "./responsive-dialog"

export function ReasonDialog({
  title,
  description,
  hint,
  submitLabel,
  rows = 3,
  initialReason = "",
  onSubmit,
  onClose,
}: {
  title: ReactNode
  description?: ReactNode
  /** under the field while there is no error */
  hint?: ReactNode
  submitLabel: string
  rows?: number
  /** a reason already typed elsewhere (e.g. the editor the dialog opened from) */
  initialReason?: string
  onSubmit: (reason: string) => Promise<void>
  onClose: () => void
}) {
  const id = useId()
  const { t, tError } = useI18n()
  const [reason, setReason] = useState(initialReason)
  const [missing, setMissing] = useState(false)
  const submit = async () => {
    if (!reason.trim()) {
      setMissing(true)
      document.getElementById(id)?.focus()
      return
    }
    try {
      await onSubmit(reason.trim())
      onClose()
    } catch (err) {
      toast.error(tError(err))
    }
  }
  return (
    <ResponsiveDialog
      open
      variant="dialog"
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      action={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <PendingButton variant="destructive">{submitLabel}</PendingButton>
        </>
      }
    >
      <Field data-invalid={missing || undefined}>
        <FieldLabel htmlFor={id}>{t("common.reason")}</FieldLabel>
        <Textarea
          id={id}
          rows={rows}
          value={reason}
          maxLength={500}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? `${id}-err` : undefined}
          onChange={(e) => {
            setReason(e.target.value)
            setMissing(false)
          }}
        />
        {missing ? (
          <FieldError id={`${id}-err`}>{t("errors.fields.required")}</FieldError>
        ) : hint ? (
          <FieldDescription>{hint}</FieldDescription>
        ) : null}
      </Field>
    </ResponsiveDialog>
  )
}
