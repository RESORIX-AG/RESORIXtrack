import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed, tx } from "@/server/middleware"
import {
  addCompanyDay,
  calendarYearWithKinds,
  companyDayOptions,
  deleteCalendar,
  deleteHoliday,
  importPreset,
  listCalendars,
  saveCalendar,
  saveHoliday,
  setDefaultCalendar,
} from "@/server/services/holiday-calendars"
import { companyDayKey, presetDays } from "@/server/services/holiday-calendars.schemas"
import { holidayPresets } from "@/server/services/holiday-presets"
import { requireAdmin } from "@/server/services/permissions"

const id = z.number().int().positive()
const day = z.iso.date()
const year = z.number().int().min(1990).max(2100)

export const fetchCalendars = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => listCalendars(actor))

export const fetchCalendarYear = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id, year }))
  .handler(({ data, context: { actor } }) => calendarYearWithKinds(actor, data.id, data.year))

/** Swiss presets: the 26 cantons (`CH-ZH`) with this year's statutory and selectable days. */
export const fetchHolidayCatalog = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ locale: z.string().max(8) }))
  .handler(({ data, context: { actor } }) => {
    requireAdmin(actor)
    return { presets: holidayPresets(data.locale) }
  })

export const fetchCompanyDays = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ calendarId: id, year }))
  .handler(({ data, context: { actor } }) => companyDayOptions(actor, data.calendarId, data.year))

export const addCompanyDayFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ calendarId: id, key: companyDayKey, year }))
  .handler(({ data, context: { actor } }) => ({
    id: tx(() => addCompanyDay(actor, data.calendarId, data.key, data.year)).id,
  }))

export const saveCalendarFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      id: id.nullable(),
      name: z.string().max(120),
      regionCode: z.string().max(32),
      presetDays,
      description: z.string().max(500),
      isDefault: z.boolean(),
    }),
  )
  .handler(({ data, context: { actor } }) => {
    const { id: calId, ...input } = data
    return { id: tx(() => saveCalendar(actor, input, calId ?? undefined)).id }
  })

export const setDefaultCalendarFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    tx(() => setDefaultCalendar(actor, data.id))
    return { ok: true }
  })

export const deleteCalendarFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    tx(() => deleteCalendar(actor, data.id))
    return { ok: true }
  })

export const saveHolidayFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      id: id.nullable(),
      calendarId: id,
      date: day,
      name: z.string().max(120),
      fraction: z.union([z.literal(1), z.literal(0.5)]),
    }),
  )
  .handler(({ data, context: { actor } }) => {
    const { id: hId, calendarId, ...input } = data
    return { id: tx(() => saveHoliday(actor, calendarId, input, hId ?? undefined)).id }
  })

export const deleteHolidayFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    const h = tx(() => deleteHoliday(actor, data.id))
    return { calendarId: h.calendarId, date: h.date, name: h.name, fraction: h.fraction }
  })

export const importHolidaysFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      calendarId: id,
      preset: z.string().max(32),
      presetDays,
      year,
      replace: z.boolean(),
    }),
  )
  .handler(({ data, context: { actor } }) => {
    const { calendarId, ...input } = data
    return tx(() => importPreset(actor, calendarId, input))
  })

export const calendarsQuery = queryOptions({ queryKey: ["admin", "calendars"], queryFn: () => fetchCalendars() })
export const calendarYearQuery = (calendarId: number, y: number) =>
  queryOptions({
    queryKey: ["admin", "calendars", calendarId, y],
    queryFn: () => fetchCalendarYear({ data: { id: calendarId, year: y } }),
  })
export const holidayCatalogQuery = (locale: string) =>
  queryOptions({
    queryKey: ["admin", "holiday-catalog", locale],
    queryFn: () => fetchHolidayCatalog({ data: { locale } }),
    staleTime: Infinity,
  })
export const companyDaysQuery = (calendarId: number, y: number) =>
  queryOptions({
    queryKey: ["admin", "calendars", calendarId, y, "company-days"],
    queryFn: () => fetchCompanyDays({ data: { calendarId, year: y } }),
  })
