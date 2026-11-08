/**
 * Dated terms on the person's profile: which fields are dated, the earlier terms and employment periods
 * (read-only), and rehiring a former employee.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { DateDialog } from "@/components/app/date-dialog"
import { SettingRow, SettingsGroup } from "@/components/app/settings"
import { Button } from "@/components/ui/button"
import { addDaysStr, fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { TERM_KEYS } from "@/server/services/timeline.schemas"
import type { UserDetail } from "@/server/services/users"
import { rehireFn } from "../api/users"
import type { UserFormValues } from "./user-form"

/** A dated term differs from the saved value, so the save asks from which day it applies. */
export function termsChanged(v: UserFormValues, saved: UserFormValues): boolean {
  return TERM_KEYS.some((k) => v[k] !== saved[k])
}

/** Earlier terms and employment periods, and rehiring once the employment has an end. */
export function EarlierTerms({ user }: { user: UserDetail }) {
  const { t, intl } = useI18n()
  const date = (d: string) => fmtDay(d, intl, { day: "numeric", month: "short", year: "numeric" })
  const [rehiring, setRehiring] = useState(false)
  const canRehire = user.employmentEnd != null && user.anonymizedAt == null && !user.isSelf
  if (!user.earlierTerms.length && !user.earlierPeriods.length && !canRehire) return null
  return (
    <SettingsGroup title={t("admin.users.earlier")}>
      {user.termsFrom ? (
        <SettingRow label={t("admin.users.current_terms_from", { date: date(user.termsFrom) })} control={null} />
      ) : null}
      {user.earlierTerms.map((e) => (
        <SettingRow
          key={e.validUntil}
          label={t("admin.users.earlier_terms", { date: date(e.validUntil) })}
          hint={[
            e.timezone.replace(/_/g, " "),
            `${e.vacationDaysPerYear} ${t("admin.users.vacation_days")}`,
            e.argExempt ? t("admin.weekly_max.exempt") : t(`admin.weekly_max.${e.legalWeeklyMaxHours}`),
            t(`admin.users.recording_${e.recordingMode}_short`),
            ...(e.regularNightWork ? [t("admin.users.regular_night_work")] : []),
          ].join(" · ")}
          control={null}
        />
      ))}
      {user.earlierPeriods.map((p) => (
        <SettingRow
          key={p.start ?? "start"}
          label={t("admin.users.earlier_period", {
            start: p.start ? date(p.start) : "?",
            end: p.end ? date(p.end) : "?",
          })}
          control={null}
        />
      ))}
      {canRehire ? (
        <SettingRow
          label={t("admin.users.rehire")}
          hint={t("admin.users.rehire_help")}
          control={
            <Button type="button" variant="outline" onClick={() => setRehiring(true)}>
              {t("admin.users.rehire")}
            </Button>
          }
        />
      ) : null}
      {rehiring ? <RehireDialog user={user} onClose={() => setRehiring(false)} /> : null}
    </SettingsGroup>
  )
}

function RehireDialog({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  return (
    <DateDialog
      title={t("admin.users.rehire_title", { name: user.name })}
      description={t("admin.users.rehire_help")}
      label={t("admin.users.rehire_start")}
      hint={t("errors.fields.before_end")}
      submitLabel={t("admin.users.rehire")}
      min={user.employmentEnd ? addDaysStr(user.employmentEnd, 1) : undefined}
      required
      onSubmit={async (start) => {
        await rehireFn({ data: { id: user.id, start } })
        toast.success(t("admin.users.rehired"))
        await qc.invalidateQueries({ queryKey: ["admin"] })
      }}
      onClose={onClose}
    />
  )
}
