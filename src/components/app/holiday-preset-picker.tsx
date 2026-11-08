import { useId } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { HolidayPreset } from "@/server/services/holiday-presets"
import { CantonMap } from "./canton-map"

export interface PresetChoice {
  key: string | null
  days: string[]
}

const SHOWN_COMMUNES = 4

/** Canton (list and map), its statutory days and a checklist of its optional and commune days. */
export function HolidayPresetPicker({
  presets,
  value,
  onChange,
  label,
  description,
  allowClear,
}: {
  presets: HolidayPreset[]
  value: PresetChoice
  onChange: (value: PresetChoice) => void
  label: string
  description?: string
  /** label of the "no preset" entry; without it a canton is required */
  allowClear?: string
}) {
  const id = useId()
  const { t, intl, holidayName } = useI18n()
  const preset = presets.find((p) => p.key === value.key)
  const pick = (key: string | null) => {
    if (key === value.key) return
    onChange({ key, days: presets.find((p) => p.key === key)?.defaultDays ?? [] })
  }
  const toggle = (name: string, on: boolean) =>
    onChange({ key: value.key, days: on ? [...value.days, name] : value.days.filter((d) => d !== name) })
  const communes = (list: string[]) =>
    list.length > SHOWN_COMMUNES
      ? t("admin.holidays.not_in_more", {
          communes: list.slice(0, SHOWN_COMMUNES).join(", "),
          count: list.length - SHOWN_COMMUNES,
        })
      : t("admin.holidays.not_in", { communes: list.join(", ") })
  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Combobox
          id={id}
          value={preset ? preset.key : null}
          onChange={pick}
          allowClear={allowClear}
          placeholder={allowClear}
          options={presets.map((p) => ({ value: p.key, label: p.label, hint: p.key }))}
        />
        {description ? <FieldDescription>{description}</FieldDescription> : null}
        <CantonMap
          value={preset?.key ?? null}
          onSelect={pick}
          labels={Object.fromEntries(presets.map((p) => [p.key, p.label]))}
          className="mt-2"
        />
      </Field>
      {preset ? (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{t("admin.holidays.always_included")}</p>
            <p className="text-sm text-muted-foreground">
              {preset.statutory.map((d) => holidayName(d.name)).join(", ")}
            </p>
          </div>
          {preset.selectable.length ? (
            <FieldSet>
              <FieldLegend variant="label">{t("admin.holidays.optional_days")}</FieldLegend>
              <FieldDescription>{t("admin.holidays.optional_days_hint")}</FieldDescription>
              <div className="flex flex-col gap-3">
                {preset.selectable.map((d) => (
                  <Field key={d.name} orientation="horizontal">
                    <Checkbox
                      id={`${id}-${d.date}`}
                      checked={value.days.includes(d.name)}
                      onCheckedChange={(c) => toggle(d.name, c)}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`${id}-${d.date}`} className="font-normal">
                        {holidayName(d.name)}
                        <span className="text-muted-foreground tabular">
                          {fmtDay(d.date, intl, { day: "numeric", month: "short" })}
                          {d.fraction < 1 ? `, ${t("admin.holidays.half_day")}` : ""}
                        </span>
                      </FieldLabel>
                      {d.exceptIn.length ? <FieldDescription>{communes(d.exceptIn)}</FieldDescription> : null}
                    </FieldContent>
                  </Field>
                ))}
              </div>
            </FieldSet>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
