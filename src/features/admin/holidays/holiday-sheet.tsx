import { toast } from "sonner"
import { z } from "zod"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { deleteHolidayFn, saveHolidayFn } from "../api/holidays"
import { EditorSheet, SheetSubmit, useAction } from "../ui"

export interface HolidayItem {
  id: number
  calendarId: number
  date: string
  name: string
  fraction: number
  kind?: "federal" | "cantonal" | "company" | null
}

export function HolidaySheet({
  calendarId,
  year,
  holiday,
  onClose,
  onDeleted,
}: {
  calendarId: number
  year: number
  holiday: HolidayItem | null
  onClose: () => void
  onDeleted: (h: HolidayItem) => void
}) {
  const { t, tError, holidayName } = useI18n()
  const save = useAction(
    (v: { date: string; name: string; fraction: string }) =>
      saveHolidayFn({
        data: {
          id: holiday?.id ?? null,
          calendarId,
          date: v.date,
          name: v.name.trim(),
          fraction: v.fraction === "0.5" ? 0.5 : 1,
        },
      }),
    { success: t("common.saved"), silentError: true, onSuccess: onClose },
  )
  const remove = useAction((h: HolidayItem) => deleteHolidayFn({ data: { id: h.id } }), {
    onSuccess: (_, h) => {
      onDeleted(h)
      onClose()
    },
  })
  const form = useAppForm({
    defaultValues: {
      date: holiday?.date ?? `${year}-01-01`,
      name: holiday ? holidayName(holiday.name) : "",
      fraction: holiday?.fraction === 0.5 ? "0.5" : "1",
    },
    validators: {
      onChange: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.fields.required"),
        name: z.string().trim().min(1, "errors.fields.required").max(120, "errors.fields.too_long"),
        fraction: z.enum(["1", "0.5"]),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      // keep the stored (English) name when it was not edited, so it stays translatable
      const payload = holiday && value.name === holidayName(holiday.name) ? { ...value, name: holiday.name } : value
      await save.mutateAsync(payload).catch((err: unknown) => {
        if (!applyServerErrors(formApi, err)) toast.error(tError(err))
      })
    },
  })
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={holiday ? t("admin.holidays.edit_holiday") : t("admin.holidays.add_holiday")}
      footer={
        <>
          {holiday ? (
            <Button
              intent="negative"
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => remove.mutate(holiday)}
              disabled={remove.isPending}
            >
              {t("common.delete")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{t("common.save")}</SheetSubmit>
        </>
      }
    >
      <form.AppForm>
        <FormRoot form={form}>
          <form.AppField name="date">{(f) => <f.DateField label={t("common.date")} />}</form.AppField>
          <form.AppField name="name">{(f) => <f.TextField label={t("common.name")} />}</form.AppField>
          <form.AppField name="fraction">
            {(f) => (
              <f.SelectField
                label={t("admin.holidays.duration")}
                description={t("admin.holidays.half_day_help")}
                options={[
                  { value: "1", label: t("admin.holidays.full_day") },
                  { value: "0.5", label: t("admin.holidays.half_day") },
                ]}
              />
            )}
          </form.AppField>
        </FormRoot>
      </form.AppForm>
    </EditorSheet>
  )
}
