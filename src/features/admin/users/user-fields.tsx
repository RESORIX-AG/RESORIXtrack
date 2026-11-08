import type { AnyFormApi } from "@tanstack/react-form"
import { useId } from "react"
import { Segmented } from "@/components/app/segmented"
import { SettingRow, SettingsGroup } from "@/components/app/settings"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { useAppForm } from "@/components/form/form"
import { Combobox } from "@/components/ui/combobox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { useI18n } from "@/lib/i18n"
import { LOCALES } from "@/lib/i18n-core"
import { type UserFormValues, userFormSchema } from "./user-form"

export function useUserForm(
  defaults: UserFormValues,
  onSubmit: (v: UserFormValues, formApi: AnyFormApi) => Promise<unknown>,
) {
  return useAppForm({
    defaultValues: defaults,
    validators: { onChange: userFormSchema },
    onSubmit: async ({ value, formApi }) => {
      await onSubmit(value, formApi)
    },
  })
}
export type UserForm = ReturnType<typeof useUserForm>

export interface UserRefs {
  teams: { id: number; name: string; color: string }[]
  calendars: { id: number; name: string; isDefault: boolean }[]
  timezones: string[]
}

/** Section heading inside long forms (grouped by space, no rules). */
export function FormGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

export function PersonFields({ form, refs, rows }: { form: UserForm; refs: UserRefs; rows?: boolean }) {
  const { t } = useI18n()
  const fields = (
    <>
      <form.AppField name="name">
        {(f) => <f.TextField row={rows} label={t("common.name")} autoComplete="off" />}
      </form.AppField>
      <form.AppField name="email">
        {(f) => <f.TextField row={rows} label={t("common.email")} type="email" autoComplete="off" />}
      </form.AppField>
      <form.AppField name="teamId">
        {(f) => (
          <f.ComboboxField
            row={rows}
            label={t("common.team")}
            options={[
              { value: "0", label: t("admin.users.no_team") },
              ...refs.teams.map((tm) => ({
                value: String(tm.id),
                label: tm.name,
                icon: <ColorDot color={tm.color} />,
              })),
            ]}
          />
        )}
      </form.AppField>
      <form.AppField name="role">
        {(f) => (
          <f.SelectField
            row={rows}
            label={t("common.role")}
            description={t("admin.users.role_help")}
            options={[
              { value: "employee", label: t("admin.roles.employee") },
              { value: "admin", label: t("admin.roles.admin") },
            ]}
          />
        )}
      </form.AppField>
    </>
  )
  const switches = (
    <>
      <form.AppField name="hr">
        {(f) => <f.SwitchField row={rows} label={t("admin.roles.hr")} description={t("admin.users.hr_help")} />}
      </form.AppField>
      <form.AppField name="projects">
        {(f) => (
          <f.SwitchField row={rows} label={t("admin.roles.projects")} description={t("admin.users.projects_help")} />
        )}
      </form.AppField>
    </>
  )
  if (rows)
    return (
      <SettingsGroup title={t("admin.users.person_group")}>
        {fields}
        {switches}
      </SettingsGroup>
    )
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields}
      <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 [&>[data-slot=field]]:items-start [&>[data-slot=field]]:rounded-lg [&>[data-slot=field]]:border [&>[data-slot=field]]:bg-card [&>[data-slot=field]]:p-3">
        {switches}
      </div>
    </div>
  )
}

export function ContractFields({ form, create, rows }: { form: UserForm; create?: boolean; rows?: boolean }) {
  const lwmLabelId = useId()
  const { t } = useI18n()
  // one field for the Labour Act: 45 h, 50 h or not applicable (senior executive); "not applicable" keeps the
  // stored weekly maximum so switching back restores it
  const weeklyMax = (
    <form.Field name="legalWeeklyMaxHours">
      {(max) => (
        <form.Field name="argExempt">
          {(exempt) => {
            const choice = (
              <Segmented
                value={exempt.state.value ? "exempt" : max.state.value}
                onValueChange={(v) => {
                  if (v === "exempt") return exempt.handleChange(true)
                  exempt.handleChange(false)
                  max.handleChange(v)
                }}
                aria-labelledby={lwmLabelId}
                fill
                options={[
                  { value: "45", label: t("admin.weekly_max.45"), description: t("admin.weekly_max.scope_45") },
                  { value: "50", label: t("admin.weekly_max.50"), description: t("admin.weekly_max.scope_50") },
                  {
                    value: "exempt",
                    label: t("admin.weekly_max.exempt"),
                    description: t("admin.weekly_max.scope_exempt"),
                  },
                ]}
              />
            )
            return rows ? (
              <SettingRow block label={t("admin.users.arg_law")} labelId={lwmLabelId} control={choice} />
            ) : (
              <Field className="sm:col-span-full">
                <FieldLabel id={lwmLabelId}>{t("admin.users.arg_law")}</FieldLabel>
                {choice}
              </Field>
            )
          }}
        </form.Field>
      )}
    </form.Field>
  )
  const fields = (
    <>
      <form.AppField name="employmentStart">
        {(f) => <f.DateField row={rows} far label={t("admin.users.employment_start")} />}
      </form.AppField>
      {create ? (
        <form.AppField name="pensumPercent">
          {(f) => (
            <f.TextField
              row={rows}
              label={t("admin.users.pensum")}
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
            />
          )}
        </form.AppField>
      ) : (
        <form.AppField name="employmentEnd">
          {(f) => <f.DateField row={rows} far label={t("admin.users.employment_end")} />}
        </form.AppField>
      )}
      <form.AppField name="vacationDaysPerYear">
        {(f) => (
          <f.TextField
            row={rows}
            controlClassName="md:w-28"
            className="text-right tabular"
            label={t("admin.users.vacation_days")}
            description={t("admin.users.vacation_days_help")}
            type="number"
            min={0}
            max={366}
            step={0.5}
            inputMode="decimal"
          />
        )}
      </form.AppField>
      <form.AppField name="recordingMode">
        {(f) => (
          <f.SelectField
            row={rows}
            label={t("admin.users.recording_mode")}
            options={[
              { value: "full", label: t("admin.users.recording_full"), short: t("admin.users.recording_full_short") },
              {
                value: "simplified",
                label: t("admin.users.recording_simplified"),
                short: t("admin.users.recording_simplified_short"),
              },
              {
                value: "waived",
                label: t("admin.users.recording_waived"),
                short: t("admin.users.recording_waived_short"),
              },
            ]}
          />
        )}
      </form.AppField>
      {weeklyMax}
      <form.AppField name="regularNightWork">
        {(f) => (
          <f.SwitchField
            row={rows}
            label={t("admin.users.regular_night_work")}
            description={t("admin.users.regular_night_work_help")}
          />
        )}
      </form.AppField>
      {!create ? (
        <form.AppField name="birthDate">
          {(f) => (
            <f.DateField
              row={rows}
              far
              label={t("admin.users.birth_date")}
              description={t("admin.users.birth_date_help")}
            />
          )}
        </form.AppField>
      ) : null}
    </>
  )
  if (rows) return <SettingsGroup title={t("admin.users.contract")}>{fields}</SettingsGroup>
  return <div className="grid gap-4 sm:grid-cols-3">{fields}</div>
}

export function RegionFields({ form, refs, rows }: { form: UserForm; refs: UserRefs; rows?: boolean }) {
  const { t } = useI18n()
  const timezoneId = useId()
  const fields = (
    <>
      <form.AppField name="locale">
        {(f) => (
          <f.SelectField
            row={rows}
            label={t("admin.users.language")}
            options={LOCALES.map((l) => ({ value: l.code, label: l.label }))}
          />
        )}
      </form.AppField>
      <form.Field name="timezone">
        {(field) => {
          const error = field.state.meta.errors.length ? t("errors.fields.required") : undefined
          const picker = (
            <Combobox
              id={timezoneId}
              value={field.state.value}
              onChange={(v) => field.handleChange(v ?? "")}
              options={refs.timezones.map((tz) => ({ value: tz, label: tz.replaceAll("_", " ") }))}
            />
          )
          return rows ? (
            <SettingRow
              label={t("admin.users.timezone")}
              htmlFor={timezoneId}
              error={error}
              control={<div className="w-full md:w-72">{picker}</div>}
            />
          ) : (
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor={timezoneId}>{t("admin.users.timezone")}</FieldLabel>
              {picker}
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          )
        }}
      </form.Field>
      <form.AppField name="holidayCalendarId">
        {(f) => (
          <f.ComboboxField
            row={rows}
            label={t("admin.users.holiday_calendar")}
            options={[
              { value: "0", label: t("admin.users.calendar_inherit") },
              ...refs.calendars.map((c) => ({
                value: String(c.id),
                label: c.name,
                badge: c.isDefault ? (
                  <StatusBadge tone="brand" className="shrink-0">
                    {t("admin.holidays.default")}
                  </StatusBadge>
                ) : undefined,
              })),
            ]}
          />
        )}
      </form.AppField>
    </>
  )
  if (rows) return <SettingsGroup title={t("admin.users.region")}>{fields}</SettingsGroup>
  return <div className="grid gap-4 sm:grid-cols-3">{fields}</div>
}
