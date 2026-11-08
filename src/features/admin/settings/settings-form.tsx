import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { EffectiveDateDialog } from "@/components/app/effective-date-dialog"
import { Segmented } from "@/components/app/segmented"
import { SettingRow, SettingsGroup } from "@/components/app/settings"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Combobox } from "@/components/ui/combobox"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/lib/i18n"
import { LOCALES } from "@/lib/i18n-core"
import type { SettingKey, Settings } from "@/server/services/settings"
import { VERSIONED_SETTINGS } from "@/server/services/settings.schemas"
import { saveSettingsFn } from "../api/settings"
import { hhmmToMinutes, minutesToHhmm } from "../lib"

type Kind = "text" | "number" | "hours" | "switch" | "toggle" | "timezone" | "locale" | "textarea" | "weekly_max"
export interface Spec {
  key: SettingKey
  kind: Kind
  options?: string[]
  min?: number
  max?: number
  step?: number
  unit?: string
  /** only shown while another setting has this value */
  when?: [SettingKey, string]
}
export interface Group {
  title: string
  fields: Spec[]
}

type Values = Record<string, string | number | boolean | null>

function toForm(spec: Spec, v: unknown): string | number | boolean | null {
  if (spec.kind === "hours") return minutesToHhmm(Number(v))
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null
}

function fromForm(spec: Spec, v: unknown): unknown {
  if (spec.kind === "hours") return hhmmToMinutes(typeof v === "string" ? v : "")
  if (spec.kind === "text" || spec.kind === "textarea") return (typeof v === "string" ? v : "").trim()
  return v
}

/** One tab of settings: grouped fields, one Save for the whole tab; only changed keys are sent. */
export function SettingsForm({
  groups,
  settings,
  timezones,
}: {
  groups: Group[]
  settings: Settings
  timezones: string[]
}) {
  const { t, tError, has } = useI18n()
  const qc = useQueryClient()
  const specs = groups.flatMap((g) => g.fields)
  const defaults: Values = Object.fromEntries(specs.map((s) => [s.key, toForm(s, settings[s.key])]))
  const [asking, setAsking] = useState<{ changes: Record<string, unknown>; value: Values } | null>(null)
  const form = useAppForm({
    defaultValues: defaults,
    onSubmit: async ({ value, formApi }) => {
      const changes: Record<string, unknown> = {}
      const bad: Record<string, string> = {}
      for (const s of specs) {
        if (value[s.key] === defaults[s.key]) continue
        const v = fromForm(s, value[s.key])
        if (v == null || (typeof v === "number" && Number.isNaN(v))) bad[s.key] = "invalid"
        else changes[s.key] = v
      }
      if (Object.keys(bad).length) {
        applyServerErrors(formApi, { fields: bad })
        return
      }
      if (!Object.keys(changes).length) return
      if (Object.keys(changes).some((k) => (VERSIONED_SETTINGS as readonly string[]).includes(k))) {
        setAsking({ changes, value })
        return
      }
      await save(changes, "", value).catch(fail)
    },
  })
  async function save(changes: Record<string, unknown>, validFrom: string, value: Values) {
    await saveSettingsFn({ data: { changes, validFrom: validFrom || undefined } })
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin"] }),
      qc.invalidateQueries({ queryKey: ["bootstrap"] }),
    ])
    toast.success(t("common.saved"))
    form.reset(value)
  }
  function fail(err: unknown) {
    if (!applyServerErrors(form, err)) toast.error(tError(err))
  }
  const label = (k: string) => t(`admin.settings.fields.${k}`)
  const help = (k: string) => (has(`admin.settings.help.${k}`) ? t(`admin.settings.help.${k}`) : undefined)

  const render = (s: Spec) => {
    switch (s.kind) {
      case "switch":
        return (
          <form.AppField key={s.key} name={s.key}>
            {(f) => <f.SwitchField row label={label(s.key)} description={help(s.key)} />}
          </form.AppField>
        )
      case "text":
        return (
          <form.AppField key={s.key} name={s.key}>
            {(f) => <f.TextField row label={label(s.key)} description={help(s.key)} />}
          </form.AppField>
        )
      case "textarea":
        return (
          <form.Field key={s.key} name={s.key}>
            {(field) => (
              <SettingRow
                block
                label={label(s.key)}
                hint={help(s.key)}
                htmlFor={`s-${s.key}`}
                control={
                  <Textarea
                    id={`s-${s.key}`}
                    value={field.state.value == null ? "" : String(field.state.value)}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="min-h-48 max-h-[60vh] font-mono text-[13px]"
                  />
                }
              />
            )}
          </form.Field>
        )
      case "locale":
        return (
          <form.AppField key={s.key} name={s.key}>
            {(f) => (
              <f.SelectField
                row
                label={label(s.key)}
                description={help(s.key)}
                options={LOCALES.map((l) => ({ value: l.code, label: l.label }))}
              />
            )}
          </form.AppField>
        )
      case "weekly_max":
        return (
          <form.Field key={s.key} name={s.key}>
            {(field) => (
              <SettingRow
                block
                label={label(s.key)}
                hint={help(s.key)}
                labelId={`s-${s.key}-label`}
                control={
                  <WeeklyMaxChoice
                    value={Number(field.state.value) >= 3000 ? "50" : "45"}
                    onChange={(v) => field.handleChange(v === "50" ? 3000 : 2700)}
                    labelledBy={`s-${s.key}-label`}
                  />
                }
              />
            )}
          </form.Field>
        )
      case "toggle":
        return (
          <form.Field key={s.key} name={s.key}>
            {(field) => (
              <SettingRow
                label={label(s.key)}
                hint={help(s.key)}
                labelId={`s-${s.key}-label`}
                control={
                  <Segmented
                    value={String(field.state.value)}
                    onValueChange={(v) => field.handleChange(v)}
                    aria-labelledby={`s-${s.key}-label`}
                    options={(s.options ?? []).map((o) => ({
                      value: o,
                      label: t(`admin.settings.options.${s.key}.${o}`),
                    }))}
                  />
                }
              />
            )}
          </form.Field>
        )
      default:
        return (
          <form.Field key={s.key} name={s.key}>
            {(field) => {
              const err = field.state.meta.errors[0] ?? (field.state.meta.errorMap as Record<string, unknown>).onServer
              const id = `s-${s.key}`
              return (
                <SettingRow
                  label={label(s.key)}
                  hint={help(s.key)}
                  htmlFor={id}
                  error={err ? t("errors.fields.invalid") : undefined}
                  control={
                    s.kind === "timezone" ? (
                      <div className="w-full md:w-72">
                        <Combobox
                          id={id}
                          value={String(field.state.value)}
                          onChange={(v) => v && field.handleChange(v)}
                          options={timezones.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))}
                        />
                      </div>
                    ) : (
                      <InputGroup className="w-36">
                        <InputGroupInput
                          id={id}
                          className="text-right tabular"
                          type={s.kind === "number" ? "number" : "text"}
                          inputMode={s.kind === "hours" ? "numeric" : "decimal"}
                          min={s.min}
                          max={s.max}
                          step={s.step}
                          placeholder={s.kind === "hours" ? "42:00" : undefined}
                          value={field.state.value == null ? "" : String(field.state.value)}
                          onChange={(e) =>
                            field.handleChange(
                              s.kind === "number"
                                ? e.target.value === ""
                                  ? null
                                  : Number(e.target.value)
                                : e.target.value,
                            )
                          }
                          onBlur={field.handleBlur}
                          aria-invalid={err ? true : undefined}
                        />
                        {s.unit || s.kind === "hours" ? (
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>
                              {s.kind === "hours"
                                ? t("admin.settings.units.hhmm")
                                : t(`admin.settings.units.${s.unit}`)}
                            </InputGroupText>
                          </InputGroupAddon>
                        ) : null}
                      </InputGroup>
                    )
                  }
                />
              )
            }}
          </form.Field>
        )
    }
  }

  return (
    <form.AppForm>
      <FormRoot form={form} className="flex flex-col gap-8">
        {groups.map((g) => (
          <SettingsGroup key={g.title} title={t(`admin.settings.groups.${g.title}`)}>
            {g.fields.map((s) => {
              if (!s.when) return render(s)
              const [key, shownFor] = s.when
              return (
                <form.Subscribe key={s.key} selector={(st) => st.values[key]}>
                  {(v) => (String(v) === shownFor ? render(s) : null)}
                </form.Subscribe>
              )
            })}
          </SettingsGroup>
        ))}
        <form.SaveBar />
      </FormRoot>
      {asking ? (
        <EffectiveDateDialog
          label={t("admin.settings.valid_from")}
          hint={t("admin.settings.valid_from_help")}
          errorField="validFrom"
          onSubmit={(from) => save(asking.changes, from, asking.value)}
          onFail={fail}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </form.AppForm>
  )
}

/** Company default or a person's legal weekly maximum (Art. 9 ArG), with the scope of each option. */
export function WeeklyMaxChoice({
  value,
  onChange,
  labelledBy,
}: {
  value: "45" | "50"
  onChange: (v: "45" | "50") => void
  labelledBy: string
}) {
  const { t } = useI18n()
  return (
    <Segmented
      value={value}
      onValueChange={onChange}
      aria-labelledby={labelledBy}
      fill
      options={[
        { value: "45", label: t("admin.weekly_max.45"), description: t("admin.weekly_max.scope_45") },
        { value: "50", label: t("admin.weekly_max.50"), description: t("admin.weekly_max.scope_50") },
      ]}
    />
  )
}
