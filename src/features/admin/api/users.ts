import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { asc } from "drizzle-orm"
import { z } from "zod"
import { passwordMatches } from "@/features/profile/server"
import { localeSchema } from "@/lib/locales"
import { db } from "@/server/db"
import { holidayCalendars, teams, users } from "@/server/db/schema"
import { Validation } from "@/server/errors"
import { authed, tx } from "@/server/middleware"
import { hashPassword } from "@/server/password"
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/server/password-policy"
import { sendInvite } from "@/server/services/invites"
import { withOutbox } from "@/server/services/outbox"
import { type Actor, getUserOr404, requireAdmin, requireHr } from "@/server/services/permissions"
import { exportPersonalData } from "@/server/services/privacy"
import { createSchedule, deleteSchedule, updateSchedule } from "@/server/services/schedules"
import { getAllSettings } from "@/server/services/settings"
import { checkNewPassword, hasPassword } from "@/server/services/user-auth"
import {
  anonymizeUser,
  createUser,
  ensureInvitable,
  getUserDetail,
  listUsers,
  rehire,
  removePasskeys,
  resetTwoFactor,
  setActive,
  setEntitlement,
  setPasswordByAdmin,
  updateUser,
  userHistory,
} from "@/server/services/users"
import { allTimezones } from "@/server/time"

const day = z.iso.date()
const id = z.number().int().positive()
/** Empty for administrators without a password; `confirmOwnPassword` rejects it for everyone else. */
const adminPassword = z.string().max(MAX_PASSWORD_LENGTH)

const profileShape = {
  name: z.string().max(120),
  email: z.string().max(254),
  role: z.enum(["admin", "employee"]),
  capabilities: z.array(z.enum(["hr", "projects"])),
  teamId: id.nullable(),
  holidayCalendarId: id.nullable(),
  timezone: z.string().max(64),
  locale: localeSchema,
  employmentStart: day.nullable(),
  employmentEnd: day.nullable(),
  vacationDaysPerYear: z.number().min(0).max(366),
  legalWeeklyMaxHours: z.union([z.literal(45), z.literal(50)]),
  recordingMode: z.enum(["full", "simplified", "waived"]),
  // senior executive (ArG Art. 3 lit. d); optional so older clients keep the stored value
  argExempt: z.boolean().optional(),
  regularNightWork: z.boolean().optional(),
  birthDate: day.nullable(),
  termsFrom: day.nullable().optional(),
}

/**
 * Step-up check: the administrator confirms with their own password before sensitive actions.
 * Administrators who sign in through single sign-on only have no password to confirm (as for API keys).
 */
async function confirmOwnPassword(actor: Actor, password: string) {
  requireAdmin(actor)
  if (!hasPassword(actor.id)) return
  if (!password || !(await passwordMatches(actor.id, password))) {
    throw new Validation("Your password is not correct", {
      code: "invalid_admin_password",
      fields: { adminPassword: "invalid" },
    })
  }
}

export const fetchUsers = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ status: z.enum(["active", "inactive", "all"]).default("active") }))
  .handler(({ data, context: { actor } }) => listUsers(actor, { status: data.status }))

export const fetchUserDetail = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => getUserDetail(actor, data.id))

export const fetchUserHistory = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => userHistory(actor, data.id))

/**
 * Choices for the people forms: teams, calendars, timezones and company defaults. `stepUpPassword`: whether
 * sensitive actions ask for the administrator's own password (single sign-on only accounts have none).
 */
export const fetchUserRefs = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => {
    requireAdmin(actor)
    const s = getAllSettings()
    return {
      teams: db
        .select({ id: teams.id, name: teams.name, color: teams.color })
        .from(teams)
        .orderBy(asc(teams.name))
        .all(),
      calendars: db
        .select({ id: holidayCalendars.id, name: holidayCalendars.name, isDefault: holidayCalendars.isDefault })
        .from(holidayCalendars)
        .orderBy(asc(holidayCalendars.name))
        .all(),
      people: db
        .select({ id: users.id, name: users.name, email: users.email, teamId: users.teamId, isActive: users.isActive })
        .from(users)
        .orderBy(asc(users.name))
        .all(),
      timezones: allTimezones(),
      defaults: {
        timezone: s.default_timezone,
        locale: s.default_locale,
        vacationDays: s.default_vacation_days,
        weeklyMaxHours: s.weekly_max_minutes > 2700 ? 50 : 45,
        fulltimeWeeklyMinutes: s.fulltime_weekly_minutes,
        retentionYears: s.retention_years,
      },
      minPasswordLength: MIN_PASSWORD_LENGTH,
      stepUpPassword: hasPassword(actor.id),
    }
  })

function tryInvite(actor: Actor, userId: number): { sent: boolean; url: string | null } {
  try {
    const r = tx(() => sendInvite(actor, userId))
    return { sent: true, url: r.url }
  } catch (err) {
    console.error("[admin] invite failed", err)
    return { sent: false, url: null }
  }
}

export const createUserFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      ...profileShape,
      employmentStart: day.nullable(),
      pensumPercent: z.number().min(1).max(100),
      sendInvite: z.boolean(),
    }),
  )
  .handler(({ data, context: { actor } }) => {
    const { sendInvite: invite, ...input } = data
    const user = withOutbox(() => tx(() => createUser(actor, input)))
    const result = invite ? tryInvite(actor, user.id) : { sent: false, url: null }
    return { id: user.id, invite: result }
  })

export const updateUserFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, patch: z.object(profileShape).partial() }))
  .handler(({ data, context: { actor } }) => {
    withOutbox(() => tx(() => updateUser(actor, data.id, data.patch)))
    return { ok: true }
  })

export const rehireFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, start: day }))
  .handler(({ data, context: { actor } }) => {
    tx(() => rehire(actor, data.id, data.start))
    return { ok: true }
  })

export const setActiveFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, active: z.boolean() }))
  .handler(({ data, context: { actor } }) => {
    tx(() => setActive(actor, data.id, data.active))
    return { ok: true }
  })

export const resendInviteFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    tx(() => ensureInvitable(actor, data.id))
    const r = tx(() => sendInvite(actor, data.id))
    return { url: r.url, expiresAt: r.expiresAt }
  })

export const setPasswordFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      id,
      password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
      adminPassword,
      notify: z.boolean(),
    }),
  )
  .handler(async ({ data, context: { actor } }) => {
    await confirmOwnPassword(actor, data.adminPassword)
    await checkNewPassword(data.password, getUserOr404(data.id).email)
    const hash = await hashPassword(data.password)
    withOutbox(() => tx(() => setPasswordByAdmin(actor, data.id, hash, { notify: data.notify })))
    return { ok: true }
  })

export const resetMfaFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, adminPassword }))
  .handler(async ({ data, context: { actor } }) => {
    await confirmOwnPassword(actor, data.adminPassword)
    withOutbox(() => tx(() => resetTwoFactor(actor, data.id)))
    return { ok: true }
  })

export const removePasskeysFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, adminPassword }))
  .handler(async ({ data, context: { actor } }) => {
    await confirmOwnPassword(actor, data.adminPassword)
    return { removed: tx(() => removePasskeys(actor, data.id)) }
  })

export const anonymizeFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, adminPassword }))
  .handler(async ({ data, context: { actor } }) => {
    await confirmOwnPassword(actor, data.adminPassword)
    return tx(() => anonymizeUser(actor, data.id))
  })

export const exportUserFn = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    // a data-access export contains working times: HR only (as in v1), never administrators without HR
    requireHr(actor)
    getUserDetail(actor, data.id)
    return exportPersonalData(data.id)
  })

export const setEntitlementFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      id,
      year: z.number().int().min(1990).max(2100),
      days: z.number().min(0).max(366).nullable(),
      note: z.string().max(200),
    }),
  )
  .handler(({ data, context: { actor } }) => {
    tx(() => setEntitlement(actor, data.id, data.year, data.days, data.note))
    return { ok: true }
  })

const minutes = z.number().int().min(0).max(1440)
const scheduleInput = z.object({
  validFrom: day,
  pensumPercent: z.number().min(1).max(100),
  minutes: z.object({
    mon: minutes,
    tue: minutes,
    wed: minutes,
    thu: minutes,
    fri: minutes,
    sat: minutes,
    sun: minutes,
  }),
})

export const saveScheduleFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ userId: id, scheduleId: id.nullable(), input: scheduleInput, reason: z.string().max(500) }))
  .handler(({ data, context: { actor } }) => {
    tx(() =>
      data.scheduleId
        ? updateSchedule(actor, data.scheduleId, data.input, data.reason)
        : createSchedule(actor, data.userId, data.input, data.reason),
    )
    return { ok: true }
  })

export const deleteScheduleFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ scheduleId: id, reason: z.string().max(500) }))
  .handler(({ data, context: { actor } }) => {
    tx(() => deleteSchedule(actor, data.scheduleId, data.reason))
    return { ok: true }
  })

export const usersQuery = (status: "active" | "inactive" | "all") =>
  queryOptions({ queryKey: ["admin", "users", status], queryFn: () => fetchUsers({ data: { status } }) })
export const userDetailQuery = (userId: number) =>
  queryOptions({ queryKey: ["admin", "user", userId], queryFn: () => fetchUserDetail({ data: { id: userId } }) })
export const userHistoryQuery = (userId: number) =>
  queryOptions({
    queryKey: ["admin", "user", userId, "history"],
    queryFn: () => fetchUserHistory({ data: { id: userId } }),
  })
export const userRefsQuery = queryOptions({
  queryKey: ["admin", "refs"],
  queryFn: () => fetchUserRefs(),
  staleTime: 60_000,
})
