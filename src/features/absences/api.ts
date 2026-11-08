import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { env } from "@/server/env"
import { Validation } from "@/server/errors"
import { authed, tx } from "@/server/middleware"
import { listAbsenceTypes, requestableTypes, serializeAbsenceType } from "@/server/services/absence-types"
import {
  absenceHistory,
  absencePreview,
  cancelAbsence,
  createAbsence,
  decideAbsence,
  getAbsenceDto,
  listAbsences,
  reportSickToday,
  selfSickAllowed,
  serializeAbsences,
  serializeAttachment,
  updateAbsence,
} from "@/server/services/absences"
import { absenceInput, absencePatch, dayString, listInput, previewInput } from "@/server/services/absences.schemas"
import { computeDaysFrom, loadContext, vacationAccount } from "@/server/services/accounts"
import { addAttachment, deleteAttachment } from "@/server/services/attachments"
import { withOutbox } from "@/server/services/outbox"
import { requireView, seesDate } from "@/server/services/permissions"
import { getSetting } from "@/server/services/settings"
import { localToday } from "@/server/time"

const id = z.number().int().positive()
const text = z.string().max(1000).default("")

export const fetchAbsenceTypes = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => ({
    all: listAbsenceTypes().map(serializeAbsenceType),
    requestable: requestableTypes(actor).map((t) => t.id),
  }))

export const fetchAbsences = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(listInput)
  .handler(({ data, context: { actor } }) => listAbsences(actor, data))

export const fetchAbsence = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => getAbsenceDto(actor, data.id))

export const fetchAbsenceHistory = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => absenceHistory(actor, data.id))

export const fetchSickCheck = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ date: dayString.nullish() }))
  .handler(({ data, context: { actor } }) => selfSickAllowed(actor.user, data.date))

export const fetchAbsencePreview = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(previewInput)
  .handler(({ data, context: { actor } }) => absencePreview(actor, data))

export const createAbsenceFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(absenceInput)
  .handler(({ data, context: { actor } }) =>
    withOutbox(() => tx(() => serializeAbsences(actor, [createAbsence(actor, data)])[0])),
  )

export const reportSickTodayFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ note: text }))
  .handler(({ data, context: { actor } }) =>
    withOutbox(() => tx(() => serializeAbsences(actor, [reportSickToday(actor, data.note)])[0])),
  )

export const updateAbsenceFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, patch: absencePatch }))
  .handler(({ data, context: { actor } }) =>
    withOutbox(() => tx(() => serializeAbsences(actor, [updateAbsence(actor, data.id, data.patch)])[0])),
  )

export const decideAbsenceFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, approve: z.boolean(), note: text }))
  .handler(({ data, context: { actor } }) =>
    withOutbox(() => tx(() => serializeAbsences(actor, [decideAbsence(actor, data.id, data.approve, data.note)])[0])),
  )

export const cancelAbsenceFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, reason: text }))
  .handler(({ data, context: { actor } }) =>
    withOutbox(() => tx(() => serializeAbsences(actor, [cancelAbsence(actor, data.id, data.reason)])[0])),
  )

/** Multipart upload: fields `absenceId` and `file`. */
export const uploadAttachmentFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Validation("Expected a file upload", { fields: { file: "required" } })
    const absenceId = Number(input.get("absenceId"))
    const file = input.get("file")
    if (!Number.isInteger(absenceId) || absenceId <= 0)
      throw new Validation("Invalid absence", { fields: { absenceId: "invalid" } })
    if (!(file instanceof File)) throw new Validation("No file uploaded", { fields: { file: "required" } })
    if (file.size > env.attachmentMaxMb * 1024 * 1024)
      throw new Validation(`The file is larger than ${env.attachmentMaxMb} MB`, { fields: { file: "too_large" } })
    return { absenceId, file }
  })
  .handler(async ({ data, context: { actor } }) => {
    const bytes = new Uint8Array(await data.file.arrayBuffer())
    return serializeAttachment(
      tx(() => addAttachment(actor, data.absenceId, { filename: data.file.name, data: bytes })),
    )
  })

export const deleteAttachmentFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, reason: text }))
  .handler(({ data, context: { actor } }) => {
    tx(() => deleteAttachment(actor, data.id, data.reason))
    return { ok: true }
  })

type ListParams = z.input<typeof listInput>
type PreviewParams = z.input<typeof previewInput>

export const absenceTypesQuery = queryOptions({
  queryKey: ["absence-types"],
  queryFn: () => fetchAbsenceTypes(),
  staleTime: 60_000,
})
export const absencesQuery = (params: ListParams) =>
  queryOptions({ queryKey: ["absences", "list", params], queryFn: () => fetchAbsences({ data: params }) })
export const absenceQuery = (absenceId: number) =>
  queryOptions({ queryKey: ["absences", absenceId], queryFn: () => fetchAbsence({ data: { id: absenceId } }) })
export const absenceHistoryQuery = (absenceId: number) =>
  queryOptions({
    queryKey: ["absences", absenceId, "history"],
    queryFn: () => fetchAbsenceHistory({ data: { id: absenceId } }),
  })
export const sickCheckQuery = (date?: string | null) =>
  queryOptions({
    queryKey: ["absences", "sick-check", date ?? null],
    queryFn: () => fetchSickCheck({ data: { date } }),
  })
export const absencePreviewQuery = (params: PreviewParams) =>
  queryOptions({ queryKey: ["absences", "preview", params], queryFn: () => fetchAbsencePreview({ data: params }) })

/** The absences page header in one call: vacation account of the year, today's sick check, self-report limits. */
export const fetchAbsenceOverview = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), year: z.number().int().min(1990).max(2100).nullish() }))
  .handler(({ data, context: { actor } }) => {
    const user = data.userId == null || data.userId === actor.id ? actor.user : requireView(actor, data.userId)
    const today = localToday(user.timezone)
    const year = data.year ?? Number(today.slice(0, 4))
    return {
      user: { id: user.id, name: user.name },
      today,
      year,
      vacation: vacationAccount(user, year),
      sick: user.id === actor.id ? selfSickAllowed(user) : null,
      sickBackdateDays: getSetting("sick_self_report_backdate_days"),
      sickMaxDays: getSetting("sick_self_report_max_days"),
    }
  })

/** Holidays, working days and active absences of one person per day (calendars, the request picker). */
export const fetchCalendarDays = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(
    z
      .object({ userId: id.nullish(), from: dayString, to: dayString })
      .refine((v) => v.to >= v.from && Temporal.PlainDate.from(v.from).until(v.to).days <= 400, {
        path: ["to"],
        message: "too_long",
      }),
  )
  .handler(({ data, context: { actor } }) => {
    const user = data.userId == null || data.userId === actor.id ? actor.user : requireView(actor, data.userId)
    const ctx = loadContext(user, data.from, data.to, { includePending: true, entries: false })
    return computeDaysFrom(ctx).map((d) => ({
      date: d.date,
      workday: d.isWorkday,
      holiday: d.holiday,
      // a lead covering from a later day sees no absences before it
      absences: seesDate(actor, user, d.date) ? d.absences : [],
    }))
  })
export type CalendarDayDto = Awaited<ReturnType<typeof fetchCalendarDays>>[number]

type OverviewParams = { userId?: number | null; year?: number | null }
type DaysParams = { userId?: number | null; from: string; to: string }

export const absenceOverviewQuery = (p: OverviewParams = {}) =>
  queryOptions({
    queryKey: ["absences", "overview", p.userId ?? null, p.year ?? null],
    queryFn: () => fetchAbsenceOverview({ data: p }),
  })
export const calendarDaysQuery = (p: DaysParams) =>
  queryOptions({
    queryKey: ["absences", "days", p.userId ?? null, p.from, p.to],
    queryFn: () => fetchCalendarDays({ data: p }),
    staleTime: 30_000,
  })
