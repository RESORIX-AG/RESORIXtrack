import { useSuspenseQuery } from "@tanstack/react-query"
import { Page, PageHeader } from "@/components/app/page"
import { PanelSkeleton, TabPanel } from "@/components/app/tab-panel"
import { TabStrip } from "@/components/app/tab-strip"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isOneOf } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { adminSettingsQuery } from "../api/settings"
import { SETTINGS_TABS, type SettingsTab } from "../search"
import { AbsenceTypesSection } from "./absence-types"
import { BrandingSection } from "./branding"
import { EmailSection } from "./email"
import { type Group, SettingsForm } from "./settings-form"

const TAB_GROUPS: Partial<Record<SettingsTab, Group[]>> = {
  company: [
    {
      title: "company",
      fields: [
        { key: "company_name", kind: "text" },
        { key: "default_timezone", kind: "timezone" },
        { key: "default_locale", kind: "locale" },
      ],
    },
  ],
  time: [
    {
      title: "hours",
      fields: [
        { key: "fulltime_weekly_minutes", kind: "hours" },
        { key: "holiday_mode", kind: "toggle", options: ["scheduled", "prorata"] },
      ],
    },
    {
      title: "vacation",
      fields: [{ key: "default_vacation_days", kind: "number", min: 0, max: 366, step: 0.5, unit: "days" }],
    },
    {
      title: "corrections",
      fields: [
        { key: "reason_required_for_past_edits", kind: "switch" },
        { key: "lead_can_edit_schedules", kind: "switch" },
        { key: "lead_can_adjust_balances", kind: "switch" },
        { key: "clock_reminder_hours", kind: "number", min: 0, max: 24, unit: "hours" },
      ],
    },
    {
      title: "sick",
      fields: [
        { key: "sick_self_report_backdate_days", kind: "number", min: 0, max: 60, unit: "days" },
        { key: "sick_self_report_max_days", kind: "number", min: 1, max: 365, unit: "days" },
      ],
    },
    {
      title: "projects",
      fields: [{ key: "project_mode", kind: "toggle", options: ["off", "optional", "required"] }],
    },
  ],
  law: [
    {
      title: "compliance",
      fields: [
        { key: "compliance_enabled", kind: "switch" },
        { key: "break_enforcement", kind: "switch", when: ["compliance_enabled", "true"] },
        { key: "weekly_max_minutes", kind: "weekly_max" },
        { key: "night_work_permitted", kind: "switch" },
        { key: "sunday_work_permitted", kind: "switch" },
      ],
    },
    {
      title: "surcharges",
      fields: [
        { key: "holiday_work_surcharge_percent", kind: "number", min: 0, max: 200, unit: "percent" },
        { key: "holiday_work_surcharge_mode", kind: "toggle", options: ["payroll", "time_credit"] },
      ],
    },
    { title: "retention", fields: [{ key: "retention_years", kind: "number", min: 5, max: 30, unit: "years" }] },
  ],
  security: [
    {
      title: "mfa",
      fields: [
        { key: "mfa_required_for_admins", kind: "switch" },
        { key: "mfa_required_for_all", kind: "switch" },
      ],
    },
    { title: "api", fields: [{ key: "api_tokens_enabled", kind: "switch" }] },
    {
      title: "sessions",
      fields: [{ key: "login_log_retention_days", kind: "number", min: 30, max: 3650, unit: "days" }],
    },
  ],
  privacy: [{ title: "privacy", fields: [{ key: "privacy_notice", kind: "textarea" }] }],
}

export function SettingsPage({ tab, onTab }: { tab: SettingsTab; onTab: (t: SettingsTab) => void }) {
  const { t } = useI18n()
  const { data } = useSuspenseQuery(adminSettingsQuery)
  return (
    <Page>
      <PageHeader title={t("admin.settings.title")} />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (isOneOf(SETTINGS_TABS, v)) onTab(v)
        }}
        className="gap-8"
      >
        <TabStrip>
          <TabsList variant="line">
            {SETTINGS_TABS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`admin.settings.tabs.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </TabStrip>
        {SETTINGS_TABS.map((k) => {
          const groups = TAB_GROUPS[k]
          return (
            <TabPanel key={k} value={k} active={k === tab} fallback={<PanelSkeleton />}>
              <div className="flex flex-col gap-8">
                {groups ? (
                  <SettingsForm
                    // a save resets this tab's form only when its own values changed, so drafts elsewhere stay
                    key={JSON.stringify(groups.flatMap((g) => g.fields.map((f) => data.settings[f.key])))}
                    groups={groups}
                    settings={data.settings}
                    timezones={data.timezones}
                  />
                ) : null}
                {k === "company" ? <BrandingSection branding={data.branding} /> : null}
                {k === "types" ? <AbsenceTypesSection /> : null}
                {k === "email" ? <EmailSection smtp={data.smtp} /> : null}
              </div>
            </TabPanel>
          )
        })}
      </Tabs>
    </Page>
  )
}
