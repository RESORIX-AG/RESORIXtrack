import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConfirmDialog } from "@/components/app/confirm"
import { HolidayPresetPicker, type PresetChoice } from "@/components/app/holiday-preset-picker"
import { OverlayActions } from "@/components/app/responsive-dialog"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import type { CalendarRow } from "@/server/services/holiday-calendars"
import { deleteCalendarFn, holidayCatalogQuery, saveCalendarFn } from "../api/holidays"
import { currentYear } from "../lib"
import { EditorSheet, SheetSubmit, useAction } from "../ui"

export function CalendarSheet({
  calendar,
  onClose,
  onSaved,
  onDeleted,
}: {
  calendar?: CalendarRow
  onClose: () => void
  onSaved: (id: number) => void
  onDeleted: () => void
}) {
  const { t } = useI18n()
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={calendar ? t("admin.holidays.edit_calendar") : t("admin.holidays.new_calendar")}
    >
      <CalendarForm calendar={calendar} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />
    </EditorSheet>
  )
}

function CalendarForm({
  calendar,
  onClose,
  onSaved,
  onDeleted,
}: {
  calendar?: CalendarRow
  onClose: () => void
  onSaved: (id: number) => void
  onDeleted: () => void
}) {
  const { t, tError, locale } = useI18n()
  const [confirm, setConfirm] = useState(false)
  const { data: catalog } = useQuery(holidayCatalogQuery(locale))
  const presets = catalog?.presets ?? []
  const labelOf = (key: string | null) => presets.find((p) => p.key === key)?.label
  const y = currentYear()
  const save = useAction(
    ({ preset, ...v }: { name: string; preset: PresetChoice; description: string; isDefault: boolean }) =>
      saveCalendarFn({
        data: {
          id: calendar?.id ?? null,
          regionCode: preset.key ?? "",
          presetDays: preset.key ? preset.days : [],
          ...v,
        },
      }),
    {
      success: calendar ? t("common.saved") : t("admin.holidays.preset_installed"),
      silentError: true,
      onSuccess: (r) => onSaved(r.id),
    },
  )
  const remove = useAction((id: number) => deleteCalendarFn({ data: { id } }), {
    success: t("admin.holidays.calendar_deleted"),
    onSuccess: onDeleted,
  })
  const form = useAppForm({
    defaultValues: {
      name: calendar?.name ?? "",
      // a code that is no preset (older imports) is dropped on save
      preset: {
        key: calendar?.hasPreset ? calendar.regionCode : null,
        days: calendar?.hasPreset ? calendar.presetDays : [],
      },
      description: calendar?.description ?? "",
      isDefault: calendar?.isDefault ?? false,
    },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, "errors.fields.required").max(120, "errors.fields.too_long"),
        preset: z.object({ key: z.string().max(32).nullable(), days: z.array(z.string()) }),
        description: z.string().max(500, "errors.fields.too_long"),
        isDefault: z.boolean(),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value)
      } catch (err) {
        if (!applyServerErrors(formApi, err)) toast.error(tError(err))
      }
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form}>
        <form.AppField name="name">{(f) => <f.TextField label={t("common.name")} />}</form.AppField>
        <form.Field name="preset">
          {(f) => (
            <HolidayPresetPicker
              presets={presets}
              value={f.state.value}
              onChange={(next) => {
                // the name follows the canton until it is typed by hand
                const name = form.getFieldValue("name").trim()
                const label = labelOf(next.key)
                if (label && (!name || name === labelOf(f.state.value.key))) form.setFieldValue("name", label)
                f.handleChange(next)
              }}
              label={t("admin.holidays.canton")}
              description={
                calendar ? t("admin.holidays.preset_hint") : t("admin.holidays.preset_years", { from: y, to: y + 1 })
              }
              allowClear={t("admin.holidays.no_preset")}
            />
          )}
        </form.Field>
        <form.AppField name="description">
          {(f) => (
            <f.TextareaField
              label={t("admin.holidays.description")}
              description={t("common.optional")}
              maxLength={500}
            />
          )}
        </form.AppField>
        <form.AppField name="isDefault">
          {(f) => <f.SwitchField label={t("admin.holidays.use_as_default")} />}
        </form.AppField>
      </FormRoot>
      <OverlayActions>
        {calendar ? (
          <Button
            intent="negative"
            variant="ghost"
            className="mr-auto text-destructive"
            onClick={() => setConfirm(true)}
          >
            {t("common.delete")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <SheetSubmit form={form}>{calendar ? t("common.save") : t("common.create")}</SheetSubmit>
      </OverlayActions>
      {calendar ? (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("admin.holidays.delete_calendar", { name: calendar.name })}
          description={t("admin.holidays.delete_calendar_message", {
            teams: calendar.teamCount,
            users: calendar.userCount,
          })}
          confirmLabel={t("common.delete")}
          typeToConfirm={calendar.teamCount + calendar.userCount > 0 || calendar.isDefault ? calendar.name : undefined}
          onConfirm={() => remove.mutateAsync(calendar.id)}
        />
      ) : null}
    </form.AppForm>
  )
}
