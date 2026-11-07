import { useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"
import { toast } from "sonner"
import { Page, PageHeader } from "@/components/app/page"
import { SaveBar } from "@/components/app/settings"
import { PanelSkeleton, TabPanel } from "@/components/app/tab-panel"
import { TabStrip } from "@/components/app/tab-strip"
import { PersonAvatar } from "@/components/app/user-menu"
import { FormRoot } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button, ButtonLink } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isOneOf } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { DEFAULT_LOCALE, isSupportedLocale } from "@/lib/locales"
import { updateUserFn, userDetailQuery, userRefsQuery } from "../api/users"
import { USER_TABS, type UserTab } from "../search"
import { useAction } from "../ui"
import { AccessPanel } from "./access-panel"
import { HistoryPanel } from "./history-panel"
import { SchedulePanel } from "./schedule-panel"
import { ContractFields, PersonFields, RegionFields, useUserForm } from "./user-fields"
import { toPayload, type UserFormValues, weeklyMaxValue } from "./user-form"
import { AccountStatus, RoleBadges } from "./users-page"
import { VacationPanel } from "./vacation-panel"

export function UserDetailPage({ userId, tab, onTab }: { userId: number; tab: UserTab; onTab: (t: UserTab) => void }) {
  const { t } = useI18n()
  const { data: u } = useSuspenseQuery(userDetailQuery(userId))
  const isLead = u.leadRoles.some((r) => r.active)
  return (
    <Page>
      <div className="-mb-3">
        <ButtonLink
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          render={<Link to="/admin/users" />}
        >
          <ChevronLeft data-icon="inline-start" />
          {t("admin.users.title")}
        </ButtonLink>
      </div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span aria-hidden>
              <PersonAvatar name={u.name} className="size-10" />
            </span>
            <span className="min-w-0 truncate">{u.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2 pt-1">
            <span className="mr-1">{u.email}</span>
            <AccountStatus
              row={{ isActive: u.isActive, invitePending: u.invitePending, anonymized: u.anonymizedAt != null }}
            />
            <RoleBadges row={{ role: u.role, capabilities: u.capabilities, isLead }} />
          </span>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (isOneOf(USER_TABS, v)) onTab(v)
        }}
        className="gap-6"
      >
        <TabStrip>
          <TabsList variant="line">
            {USER_TABS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`admin.users.tabs.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </TabStrip>
        <TabPanel value="profile" active={tab === "profile"} fallback={<PanelSkeleton />}>
          <ProfileForm key={`${u.id}-${u.email}-${u.name}`} userId={u.id} />
        </TabPanel>
        <TabPanel value="schedule" active={tab === "schedule"} fallback={<PanelSkeleton />}>
          <SchedulePanel user={u} />
        </TabPanel>
        <TabPanel value="vacation" active={tab === "vacation"} fallback={<PanelSkeleton />}>
          <VacationPanel user={u} />
        </TabPanel>
        <TabPanel value="access" active={tab === "access"} fallback={<PanelSkeleton />}>
          <AccessPanel user={u} />
        </TabPanel>
        <TabPanel value="history" active={tab === "history"} fallback={<PanelSkeleton />}>
          <HistoryPanel userId={u.id} />
        </TabPanel>
      </Tabs>
    </Page>
  )
}

function ProfileForm({ userId }: { userId: number }) {
  const { t, tError } = useI18n()
  const { data: u } = useSuspenseQuery(userDetailQuery(userId))
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  const save = useAction((v: UserFormValues) => updateUserFn({ data: { id: u.id, patch: toPayload(v) } }), {
    success: t("common.saved"),
    silentError: true,
  })
  const defaults: UserFormValues = {
    name: u.name,
    email: u.email,
    role: u.role,
    hr: u.capabilities.includes("hr"),
    projects: u.capabilities.includes("projects"),
    teamId: String(u.teamId ?? 0),
    holidayCalendarId: String(u.holidayCalendarId ?? 0),
    timezone: u.timezone,
    locale: isSupportedLocale(u.locale) ? u.locale : DEFAULT_LOCALE,
    employmentStart: u.employmentStart ?? "",
    employmentEnd: u.employmentEnd ?? "",
    birthDate: u.birthDate ?? "",
    vacationDaysPerYear: u.vacationDaysPerYear,
    legalWeeklyMaxHours: weeklyMaxValue(u.legalWeeklyMaxHours),
    recordingMode: u.recordingMode,
    argExempt: u.argExempt,
    regularNightWork: u.regularNightWork,
    pensumPercent: 100,
    sendInvite: false,
  }
  const form = useUserForm(defaults, async (v, formApi) => {
    try {
      await save.mutateAsync(v)
      formApi.reset(v)
    } catch (err) {
      if (!applyServerErrors(formApi, err)) toast.error(tError(err))
    }
  })
  const locked = u.anonymizedAt != null
  return (
    <form.AppForm>
      <FormRoot form={form} className="flex flex-col gap-8">
        <fieldset disabled={locked} className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-2 xl:items-start">
          <div className="flex flex-col gap-8">
            <PersonFields form={form} refs={refs} rows />
            <RegionFields form={form} refs={refs} rows />
          </div>
          <ContractFields form={form} rows />
        </fieldset>
        {locked ? null : (
          <form.Subscribe selector={(st) => !st.isDefaultValue}>
            {(dirty) => (
              <SaveBar dirty={dirty} label={t("admin.settings.unsaved")}>
                {dirty ? (
                  <Button type="button" variant="ghost" onClick={() => form.reset()}>
                    {t("common.discard")}
                  </Button>
                ) : null}
                <form.SubmitButton>{t("common.save")}</form.SubmitButton>
              </SaveBar>
            )}
          </form.Subscribe>
        )}
      </FormRoot>
    </form.AppForm>
  )
}
