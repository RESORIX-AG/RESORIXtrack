import { useSuspenseQuery } from "@tanstack/react-query"
import { CalendarX } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ScheduleEditor } from "@/features/schedules/schedule-editor"
import { todayIn } from "@/features/time/lib"
import { fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { UserDetail } from "@/server/services/users"
import { userRefsQuery } from "../api/users"

/** The person's schedule versions; editable here by HR (admins without HR set only the first one on create). */
export function SchedulePanel({ user }: { user: UserDetail }) {
  const { t, intl } = useI18n()
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  // days after the employment start without any version have no target (data from before the rule)
  const start = user.earlierPeriods.at(-1)?.start ?? user.employmentStart
  const first = user.schedules.at(-1)?.validFrom
  const gap = start != null && first != null && first > start
  return (
    <div className="flex flex-col gap-6">
      {gap ? (
        <Alert>
          <CalendarX aria-hidden />
          <AlertDescription>
            {t("admin.schedule.gap", {
              from: fmtDay(start, intl, { day: "numeric", month: "short", year: "numeric" }),
              to: fmtDay(first, intl, { day: "numeric", month: "short", year: "numeric" }),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      <ScheduleEditor
        userId={user.id}
        data={{
          schedules: user.schedules,
          canEdit: user.canEditSchedules,
          fulltimeWeeklyMinutes: refs.defaults.fulltimeWeeklyMinutes,
          today: todayIn(user.timezone),
        }}
      />
    </div>
  )
}
