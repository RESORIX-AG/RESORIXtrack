import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { z } from "zod"
import { SettingsFooter, SettingsGroup } from "@/components/app/settings"
import { FormRoot, useAppForm } from "@/components/form/form"
import { newPasswordValidator, passwordsDiffer } from "@/features/auth/password-fields"
import { failure } from "@/lib/attempt"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { LOCALES } from "@/lib/i18n-core"
import { DEFAULT_LOCALE, isSupportedLocale } from "@/lib/locales"
import { changePassword, profileQuery, saveProfile } from "./api"

export function PersonalSection() {
  const { t, tError } = useI18n()
  const qc = useQueryClient()
  const { data } = useSuspenseQuery(profileQuery)
  const p = data.profile
  const form = useAppForm({
    defaultValues: {
      name: p.name,
      locale: isSupportedLocale(p.locale) ? p.locale : DEFAULT_LOCALE,
      timezone: p.timezone,
      timeFormat: p.timeFormat,
      notifyEmailOnCorrection: p.notifyEmailOnCorrection,
    },
    onSubmit: async ({ value, formApi }) => {
      const timeFormat = value.timeFormat === "12h" ? "12h" : "24h"
      const failed = await failure(saveProfile({ data: { ...value, timeFormat } }))
      if (failed) {
        const message = tError(failed.error)
        if (errorFields(failed.error)?.timezone)
          formApi.setFieldMeta("timezone", (m) => ({
            ...m,
            isBlurred: true,
            errorMap: { ...m.errorMap, onServer: message },
          }))
        else toast.error(message)
        return
      }
      toast.success(t("common.saved"))
      formApi.reset(value)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["profile"] }),
        qc.invalidateQueries({ queryKey: ["bootstrap"] }),
      ])
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form} className="contents">
        <SettingsGroup title={t("profile.personal")}>
          <form.AppField name="name" validators={{ onBlur: z.string().trim().min(1, "common.required") }}>
            {(f) => <f.TextField row label={t("common.name")} autoComplete="name" />}
          </form.AppField>
          <form.AppField name="locale">
            {(f) => (
              <f.SelectField
                row
                label={t("profile.language")}
                options={LOCALES.map((l) => ({ value: l.code, label: l.label }))}
              />
            )}
          </form.AppField>
          <form.AppField name="timezone">
            {(f) => (
              <f.ComboboxField
                row
                label={t("profile.timezone")}
                options={data.timezones.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }))}
              />
            )}
          </form.AppField>
          <form.AppField name="timeFormat">
            {(f) => (
              <f.SegmentedField
                row
                label={t("profile.time_format")}
                options={[
                  { value: "24h", label: t("profile.time_format_24") },
                  { value: "12h", label: t("profile.time_format_12") },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="notifyEmailOnCorrection">
            {(f) => <f.SwitchField row label={t("profile.notify_corrections")} />}
          </form.AppField>
          <form.Subscribe selector={(st) => !st.isDefaultValue}>
            {(dirty) => (
              <SettingsFooter note={dirty ? t("admin.settings.unsaved") : undefined}>
                <form.SubmitButton variant={dirty ? "default" : "outline"}>{t("common.save")}</form.SubmitButton>
              </SettingsFooter>
            )}
          </form.Subscribe>
        </SettingsGroup>
      </FormRoot>
    </form.AppForm>
  )
}

export function PasswordSection() {
  const { t, tError } = useI18n()
  const qc = useQueryClient()
  const form = useAppForm({
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
    onSubmit: async ({ value, formApi }) => {
      const failed = await failure(
        changePassword({ data: { currentPassword: value.currentPassword, newPassword: value.newPassword } }),
      )
      if (failed) {
        const message = tError(failed.error)
        const fields = errorFields(failed.error) ?? {}
        const field = fields.currentPassword ? "currentPassword" : fields.newPassword ? "newPassword" : null
        if (field)
          formApi.setFieldMeta(field, (m) => ({
            ...m,
            isBlurred: true,
            errorMap: { ...m.errorMap, onServer: message },
          }))
        else toast.error(message)
        return
      }
      formApi.reset()
      toast.success(t("profile.password_changed"))
      await qc.invalidateQueries({ queryKey: ["profile"] })
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form} className="contents">
        <SettingsGroup title={t("profile.password")}>
          <form.AppField name="currentPassword" validators={{ onBlur: z.string().min(1, "common.required") }}>
            {(f) => (
              <f.TextField row label={t("profile.current_password")} type="password" autoComplete="current-password" />
            )}
          </form.AppField>
          <form.AppField name="newPassword" validators={{ onBlur: newPasswordValidator }}>
            {(f) => (
              <f.TextField
                row
                label={t("auth.new_password")}
                description={t("auth.password_rules")}
                type="password"
                autoComplete="new-password"
              />
            )}
          </form.AppField>
          <form.AppField
            name="confirm"
            validators={{
              onChangeListenTo: ["newPassword"],
              onBlur: ({ value, fieldApi }) => passwordsDiffer(value, fieldApi.form.getFieldValue("newPassword")),
            }}
          >
            {(f) => <f.TextField row label={t("auth.confirm_password")} type="password" autoComplete="new-password" />}
          </form.AppField>
          <SettingsFooter note={t("profile.password_effect")}>
            <form.SubmitButton variant="outline">{t("profile.change_password")}</form.SubmitButton>
          </SettingsFooter>
        </SettingsGroup>
      </FormRoot>
    </form.AppForm>
  )
}
