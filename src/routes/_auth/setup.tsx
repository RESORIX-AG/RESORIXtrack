import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { HolidayPresetPicker } from "@/components/app/holiday-preset-picker"
import { focusField } from "@/components/form/focus-field"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { runSetup, setupInfoQuery } from "@/features/auth/api"
import { AuthCard } from "@/features/auth/components"
import { setLocaleCookie } from "@/features/auth/lib"
import { newPasswordValidator, passwordsDiffer } from "@/features/auth/password-fields"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { LOCALES } from "@/lib/i18n-core"

export const Route = createFileRoute("/_auth/setup")({
  beforeLoad: ({ context }) => {
    if (context.bootstrap.company.setupComplete) throw redirect({ to: context.bootstrap.me ? "/" : "/login" })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(setupInfoQuery),
  component: Setup,
})

const required = z.string().trim().min(1, "common.required")

const STEPS = [
  { key: "company", fields: ["setupCode", "companyName", "locale", "timezone"] },
  { key: "time", fields: ["weeklyHours", "vacationDays"] },
  { key: "holidays", fields: ["holidays"] },
  { key: "admin", fields: ["adminName", "adminEmail", "adminPassword", "confirm"] },
] as const

function browserTz(fallback: string): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback
  } catch {
    return fallback
  }
}

function Setup() {
  const { t, locale, tError } = useI18n()
  const { data: info } = useSuspenseQuery(setupInfoQuery)
  const router = useRouter()
  const qc = useQueryClient()
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // number fields are null while empty
  const zurich = info.presets.find((p) => p.key === "CH-ZH")
  const defaults: { weeklyHours: number | null; vacationDays: number | null } = { weeklyHours: 42, vacationDays: 25 }
  const form = useAppForm({
    defaultValues: {
      setupCode: "",
      companyName: "",
      locale,
      timezone: browserTz("Europe/Zurich"),
      ...defaults,
      holidays: { key: zurich ? "CH-ZH" : null, days: zurich?.defaultDays ?? [] },
      adminName: "",
      adminEmail: "",
      adminPassword: "",
      confirm: "",
    },
    onSubmit: async ({ value, formApi }) => {
      setError(null)
      const holidayPreset = value.holidays.key
      const outcome = await runSetup({
        data: {
          setupCode: value.setupCode || undefined,
          companyName: value.companyName,
          locale: value.locale,
          timezone: value.timezone,
          fulltimeWeeklyMinutes: Math.round(Number(value.weeklyHours) * 60),
          defaultVacationDays: Number(value.vacationDays),
          holidayPreset,
          holidayPresetDays: value.holidays.days,
          adminName: value.adminName,
          adminEmail: value.adminEmail.trim(),
          adminPassword: value.adminPassword,
        },
      }).then(
        (res) => ({ res, error: null }),
        (err: unknown) => ({ res: null, error: err }),
      )
      if (!outcome.res) {
        const message = tError(outcome.error)
        const fields = errorFields(outcome.error) ?? {}
        if (fields.setupCode) setStep(0)
        else if (fields.adminPassword)
          formApi.setFieldMeta("adminPassword", (m) => ({
            ...m,
            isBlurred: true,
            errorMap: { ...m.errorMap, onServer: message },
          }))
        setError(message)
        return
      }
      if (!outcome.res.holidaysInstalled && holidayPreset) toast.warning(t("setup.holidays_failed"))
      await qc.invalidateQueries()
      await router.navigate({ to: "/" })
    },
  })

  async function nextStep() {
    const fields = STEPS[step].fields
    await Promise.all(fields.map((f) => Promise.resolve(form.validateField(f, "submit"))))
    const invalid = fields.find((f) => (form.getFieldMeta(f)?.errors.length ?? 0) > 0)
    if (invalid) {
      form.setFieldMeta(invalid, (m) => ({ ...m, isBlurred: true }))
      focusField(document, invalid)
      return
    }
    setStep((s) => s + 1)
  }

  const last = step === STEPS.length - 1
  return (
    <AuthCard
      title={t(`setup.step_${STEPS[step].key}`)}
      description={t("setup.progress", { step: step + 1, total: STEPS.length })}
    >
      {/* Enter moves to the next step; only the last step submits */}
      <div
        onSubmitCapture={(e) => {
          if (last) return
          e.preventDefault()
          e.stopPropagation()
          void nextStep()
        }}
      >
        <form.AppForm>
          <FormRoot form={form}>
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className={step === 0 ? "contents" : "hidden"}>
              {info.codeRequired ? (
                <form.AppField name="setupCode" validators={{ onBlur: required }}>
                  {(f) => (
                    <f.TextField
                      label={t("setup.code")}
                      description={t("setup.code_help")}
                      autoComplete="off"
                      className="font-mono uppercase"
                    />
                  )}
                </form.AppField>
              ) : null}
              <form.AppField name="companyName" validators={{ onBlur: required }}>
                {(f) => <f.TextField label={t("setup.company")} autoComplete="organization" />}
              </form.AppField>
              <form.AppField
                name="locale"
                listeners={{
                  onChange: ({ value }) => {
                    setLocaleCookie(value)
                    void qc.invalidateQueries({ queryKey: ["bootstrap"] })
                  },
                }}
              >
                {(f) => (
                  <f.SelectField
                    label={t("profile.language")}
                    options={LOCALES.map((l) => ({ value: l.code, label: l.label }))}
                  />
                )}
              </form.AppField>
              <form.AppField name="timezone">
                {(f) => (
                  <f.ComboboxField
                    label={t("profile.timezone")}
                    options={info.timezones.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }))}
                  />
                )}
              </form.AppField>
            </div>
            <div className={step === 1 ? "contents" : "hidden"}>
              <form.AppField
                name="weeklyHours"
                validators={{
                  onBlur: z
                    .number({ error: "common.required" })
                    .min(1, "setup.hours_range")
                    .max(100, "setup.hours_range"),
                }}
              >
                {(f) => <f.TextField label={t("setup.weekly_hours")} type="number" step="0.25" inputMode="decimal" />}
              </form.AppField>
              <form.AppField
                name="vacationDays"
                validators={{
                  onBlur: z
                    .number({ error: "common.required" })
                    .min(0, "setup.days_range")
                    .max(366, "setup.days_range"),
                }}
              >
                {(f) => <f.TextField label={t("setup.vacation_days")} type="number" step="0.5" inputMode="decimal" />}
              </form.AppField>
            </div>
            <div className={step === 2 ? "contents" : "hidden"}>
              <form.Field name="holidays">
                {(f) => (
                  <HolidayPresetPicker
                    presets={info.presets}
                    value={f.state.value}
                    onChange={f.handleChange}
                    label={t("setup.holidays")}
                    description={t("setup.holidays_help")}
                    allowClear={t("setup.no_holidays")}
                  />
                )}
              </form.Field>
            </div>
            <div className={step === 3 ? "contents" : "hidden"}>
              <form.AppField name="adminName" validators={{ onBlur: required }}>
                {(f) => <f.TextField label={t("common.name")} autoComplete="name" />}
              </form.AppField>
              <form.AppField name="adminEmail" validators={{ onBlur: z.email("auth.email_invalid") }}>
                {(f) => <f.TextField label={t("common.email")} type="email" autoComplete="username" />}
              </form.AppField>
              <form.AppField name="adminPassword" validators={{ onBlur: newPasswordValidator }}>
                {(f) => (
                  <f.TextField
                    label={t("auth.password")}
                    description={t("auth.password_rules")}
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </form.AppField>
              <form.AppField
                name="confirm"
                validators={{
                  onChangeListenTo: ["adminPassword"],
                  onBlur: ({ value, fieldApi }) => passwordsDiffer(value, fieldApi.form.getFieldValue("adminPassword")),
                }}
              >
                {(f) => <f.TextField label={t("auth.confirm_password")} type="password" autoComplete="new-password" />}
              </form.AppField>
              {!info.mailConfigured ? <p className="text-xs text-muted-foreground">{t("setup.no_smtp")}</p> : null}
            </div>
            <div className="flex justify-between gap-2">
              {step > 0 ? (
                <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                  {t("common.back")}
                </Button>
              ) : (
                <span />
              )}
              {last ? (
                <form.SubmitButton>{t("setup.finish")}</form.SubmitButton>
              ) : (
                <Button type="button" onClick={nextStep}>
                  {t("common.next")}
                </Button>
              )}
            </div>
          </FormRoot>
        </form.AppForm>
      </div>
    </AuthCard>
  )
}
