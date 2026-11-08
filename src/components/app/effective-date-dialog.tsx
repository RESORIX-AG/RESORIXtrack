/** Asked on save once dated values changed: the first day they apply ("" = today). */
import type { ReactNode } from "react"
import { useI18n } from "@/lib/i18n"
import { DateDialog } from "./date-dialog"

export function EffectiveDateDialog({
  label,
  hint,
  errorField,
  onSubmit,
  onFail,
  onClose,
}: {
  label: ReactNode
  hint: ReactNode
  /** the server's field name for the date */
  errorField: string
  onSubmit: (from: string) => Promise<void>
  onFail: (err: unknown) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <DateDialog
      title={t("admin.common.changes_from_title")}
      label={label}
      hint={hint}
      submitLabel={t("common.save")}
      size="sm"
      placeholder={t("common.today")}
      errorField={errorField}
      onSubmit={onSubmit}
      onFail={onFail}
      onClose={onClose}
    />
  )
}
