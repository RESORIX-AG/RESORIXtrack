import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConfirmDialog } from "@/components/app/confirm"
import { Segmented } from "@/components/app/segmented"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"

import { useI18n } from "@/lib/i18n"
import type { CalendarRow } from "@/server/services/holiday-calendars"
import { createFromPresetFn, deleteCalendarFn, holidayCatalogQuery, saveCalendarFn } from "../api/holidays"
import { currentYear } from "../lib"
import { EditorSheet, SheetSubmit, useAction } from "../ui"

const CREATE_MODES = ["preset", "empty"] as const

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
  const [mode, setMode] = useState<(typeof CREATE_MODES)[number]>(calendar ? "empty" : "preset")
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={calendar ? t("admin.holidays.edit_calendar") : t("admin.holidays.new_calendar")}
      footer={null}
    >
      <div className="flex flex-col gap-6">
        {!calendar ? (
          <Segmented
            value={mode}
            onValueChange={setMode}
            fill
            aria-label={t("admin.holidays.new_calendar")}
            options={[
              { value: "preset", label: t("admin.holidays.from_preset") },
              { value: "empty", label: t("admin.holidays.empty_calendar") },
            ]}
          />
        ) : null}
        {mode === "preset" && !calendar ? (
          <PresetForm onClose={onClose} onSaved={onSaved} />
        ) : (
          <CalendarForm calendar={calendar} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />
        )}
      </div>
    </EditorSheet>
  )
}

function PresetForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const presetId = useId()
  const presetDefaultId = useId()
  const { t, locale } = useI18n()
  const { data } = useQuery(holidayCatalogQuery(locale))
  const [key, setKey] = useState<string | null>("CH-ZH")
  const [makeDefault, setMakeDefault] = useState(true)
  const y = currentYear()
  const run = useAction(() => createFromPresetFn({ data: { key: key!, years: [y, y + 1], makeDefault } }), {
    success: t("admin.holidays.preset_installed"),
    onSuccess: (r) => onSaved(r.id),
  })
  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor={presetId}>{t("admin.holidays.preset")}</FieldLabel>
        <Combobox
          id={presetId}
          value={key}
          onChange={setKey}
          options={(data?.presets ?? []).map((p) => ({
            value: p.key,
            label: p.label,
            hint: p.key.startsWith("CH-") ? p.key : undefined,
          }))}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Switch id={presetDefaultId} checked={makeDefault} onCheckedChange={setMakeDefault} />
        <Label htmlFor={presetDefaultId}>{t("admin.holidays.use_as_default")}</Label>
      </div>
      <p className="text-sm text-muted-foreground">{t("admin.holidays.preset_years", { from: y, to: y + 1 })}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => run.mutate(undefined)} disabled={!key || run.isPending}>
          {run.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t("common.create")}
        </Button>
      </div>
    </div>
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
  const save = useAction(
    (v: { name: string; regionCode: string; description: string; isDefault: boolean }) =>
      saveCalendarFn({ data: { id: calendar?.id ?? null, ...v } }),
    {
      success: t("common.saved"),
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
      regionCode: calendar?.hasPreset ? calendar.regionCode : "",
      description: calendar?.description ?? "",
      isDefault: calendar?.isDefault ?? false,
    },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, "errors.fields.required").max(120, "errors.fields.too_long"),
        regionCode: z.string().max(32, "errors.fields.too_long"),
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
        <form.AppField name="regionCode">
          {(f) => (
            <f.ComboboxField
              label={t("admin.holidays.preset")}
              description={t("admin.holidays.preset_hint")}
              allowClear={t("admin.holidays.no_preset")}
              placeholder={t("admin.holidays.no_preset")}
              options={presets.map((p) => ({
                value: p.key,
                label: p.label,
                hint: p.key.startsWith("CH-") ? p.key : undefined,
              }))}
            />
          )}
        </form.AppField>
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
        <div className="flex justify-end gap-2">
          {calendar ? (
            <Button
              intent="negative"
              type="button"
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => setConfirm(true)}
            >
              {t("common.delete")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{t("common.save")}</SheetSubmit>
        </div>
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
            typeToConfirm={
              calendar.teamCount + calendar.userCount > 0 || calendar.isDefault ? calendar.name : undefined
            }
            onConfirm={() => remove.mutateAsync(calendar.id)}
          />
        ) : null}
      </FormRoot>
    </form.AppForm>
  )
}
