/**
 * A short decision that needs one date. A server error on the date (`errorField`) stays at the picker; any other
 * failure closes the dialog and goes to `onFail`, so the form behind it can show it, or without `onFail` shows
 * as a toast while the dialog stays open for another try.
 */
import { type ReactNode, useId, useState } from "react"
import { toast } from "sonner"
import { messageOf } from "@/components/form/form"
import { PendingButton } from "@/components/form/pending-button"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import type { SheetSize } from "@/components/ui/sheet"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { ResponsiveDialog } from "./responsive-dialog"

export function DateDialog({
  title,
  description,
  label,
  hint,
  submitLabel,
  size,
  placeholder,
  min,
  required,
  errorField,
  onSubmit,
  onFail,
  onClose,
}: {
  title: ReactNode
  description?: ReactNode
  label: ReactNode
  hint: ReactNode
  submitLabel: ReactNode
  size?: SheetSize
  placeholder?: string
  min?: string
  /** an empty date focuses the picker instead of submitting */
  required?: boolean
  /** the server's field name for the date */
  errorField?: string
  onSubmit: (date: string) => Promise<void>
  onFail?: (err: unknown) => void
  onClose: () => void
}) {
  const id = useId()
  const { t, tError } = useI18n()
  const [date, setDate] = useState("")
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (required && !date) {
      document.getElementById(id)?.focus()
      return
    }
    try {
      await onSubmit(date)
      onClose()
    } catch (err) {
      const code = errorField ? errorFields(err)?.[errorField] : undefined
      if (code != null) {
        setError(messageOf(typeof code === "string" ? code : "invalid", t))
        document.getElementById(id)?.focus()
      } else if (onFail) {
        onClose()
        onFail(err)
      } else toast.error(tError(err))
    }
  }
  return (
    <ResponsiveDialog
      open
      variant="dialog"
      size={size}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      action={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <PendingButton>{submitLabel}</PendingButton>
        </>
      }
    >
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <DatePicker
          id={id}
          value={date}
          onChange={(v) => {
            setDate(v)
            setError(null)
          }}
          placeholder={placeholder}
          min={min}
          invalid={error != null}
          aria-describedby={`${id}-help`}
          far
        />
        {error ? (
          <FieldError id={`${id}-help`}>{error}</FieldError>
        ) : (
          <FieldDescription id={`${id}-help`}>{hint}</FieldDescription>
        )}
      </Field>
    </ResponsiveDialog>
  )
}
