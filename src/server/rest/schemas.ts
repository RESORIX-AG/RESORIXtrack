/**
 * REST API v1 shapes. Response schemas are the public contract: the router parses every handler result with
 * them, which also strips internal fields, and the OpenAPI document is generated from the same schemas.
 * Instants are ISO 8601 in UTC (`Z`), days `YYYY-MM-DD` in the person's timezone, durations in minutes.
 */
import { z } from "zod"

/** Named schemas become components of the OpenAPI document (`id` in zod's global metadata registry). */
const named = <T extends z.ZodType>(id: string, schema: T): T => schema.meta({ id })

export const instant = z.string().meta({ format: "date-time", examples: ["2026-11-05T07:58:00.000Z"] })
export const day = z.iso.date().meta({ examples: ["2026-11-05"] })
export const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .meta({ examples: ["2026-11"] })
const id = z.number().int().positive()
const minutes = z.number()

// ------------------------------------------------------------------ query helpers

export const qId = z.coerce.number().int().positive()
export const qYear = z.coerce.number().int().min(1990).max(2100)
export const qLimit = z.coerce.number().int().min(1).max(500).default(100)
export const qCursor = z.string().max(200).optional()
export const qBool = z.enum(["true", "false"]).transform((v) => v === "true")

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().meta({ description: "Pass as `cursor` for the next page; null on the last." }),
  })

// ------------------------------------------------------------------ people

export const UserRef = named("UserRef", z.object({ id, name: z.string() }))

export const Me = named(
  "Me",
  z.object({
    id,
    name: z.string(),
    email: z.string(),
    timezone: z.string(),
    locale: z.string(),
    teamId: id.nullable(),
    isAdmin: z.boolean(),
    isHr: z.boolean(),
    isLead: z.boolean(),
    scopes: z.array(z.string()).meta({ description: "Scopes of the key used for this request." }),
    company: z.object({ name: z.string(), timezone: z.string() }),
  }),
)

export const Person = named(
  "Person",
  z.object({
    id,
    name: z.string(),
    email: z.string(),
    teamId: id.nullable(),
    teamName: z.string().nullable(),
    timezone: z.string(),
    isActive: z.boolean(),
  }),
)

// ------------------------------------------------------------------ time

export const Project = named(
  "Project",
  z.object({ id, name: z.string(), code: z.string(), color: z.string().meta({ description: "#rrggbb" }) }),
)

/** What an entry's time was spent on (inputs). */
export const projectFields = {
  projectId: id.nullish().meta({ description: "A project from GET /projects; null clears it." }),
}

export const Entry = named(
  "Entry",
  z.object({
    id,
    userId: id,
    kind: z.enum(["work", "break"]).meta({ description: "`break` only on legacy rows; a break is a clock-out." }),
    startAt: instant,
    endAt: instant.nullable(),
    running: z.boolean(),
    scheduledEndAt: instant.nullable().meta({ description: "When a running entry closes automatically." }),
    minutes,
    tz: z.string(),
    note: z.string(),
    projectId: id.nullable(),
    project: z.object({ id, name: z.string(), code: z.string(), color: z.string(), isActive: z.boolean() }).nullable(),
    source: z.enum(["clock", "manual", "api", "desktop", "offline"]),
    edited: z.boolean(),
    corrected: z.boolean().meta({ description: "Created or changed by someone else (lead, HR)." }),
    deleted: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
  }),
)

export const ClockState = named(
  "ClockState",
  z.object({
    state: z.enum(["idle", "working"]),
    since: instant.nullable().meta({ description: "Start of the running entry." }),
    scheduledEnd: instant.nullable().meta({ description: "Scheduled clock-out of the running entry, if any." }),
    entry: Entry.nullable(),
    todayWorkedMin: minutes,
    todayBreakMin: minutes,
    serverTime: instant,
  }),
)

export const ClockResult = named(
  "ClockResult",
  ClockState.extend({
    replayed: z.boolean().meta({ description: "True when `clientId` was already processed; nothing changed." }),
  }),
)

export const DayAbsence = z.object({
  id,
  typeKey: z.string(),
  label: z.string(),
  category: z.enum(["vacation", "sick", "other"]),
  status: z.enum(["pending", "approved"]),
  halves: z.array(z.enum(["am", "pm"])),
})

export const Day = named(
  "Day",
  z.object({
    date: day,
    weekday: z.number().int().meta({ description: "0 = Monday" }),
    isWorkday: z.boolean(),
    isFuture: z.boolean(),
    isToday: z.boolean().meta({ description: "Today in the person's timezone; the day is still in progress." }),
    employed: z.boolean(),
    scheduledMin: minutes,
    targetMin: minutes,
    workedMin: minutes,
    breakMin: minutes,
    deltaMin: minutes,
    holiday: z.object({ name: z.string(), fraction: z.number() }).nullable(),
    holidayCreditMin: minutes,
    absenceCreditMin: minutes,
    extraCreditMin: minutes,
    sundayWorkMin: minutes.meta({ description: "Work between Saturday 23:00 and Sunday 23:00 (ArG Art. 18)." }),
    holidayWorkMin: minutes.meta({ description: "Work on a public holiday, from 23:00 the evening before." }),
    nightWorkMin: minutes.meta({ description: "Work between 23:00 and 06:00 (ArG Art. 16)." }),
    surchargeMin: minutes.meta({ description: "Sunday/holiday surcharge credited as time (time-credit mode)." }),
    nightCreditMin: minutes.meta({ description: "10 % time credit for regular night work (ArG Art. 17b)." }),
    firstStart: instant.nullable(),
    lastEnd: instant.nullable(),
    running: z.boolean(),
    vacationDays: z.number(),
    absences: z.array(DayAbsence),
    warnings: z.array(z.string()),
    edited: z.boolean(),
    projectMin: minutes.meta({ description: "Worked minutes with a project." }),
    projectOk: z.boolean().meta({ description: "False on a past day with work without a project (required mode)." }),
  }),
)

export const Summary = named(
  "Summary",
  z.object({
    scheduledMin: minutes,
    targetMin: minutes.meta({ description: "Target of complete days (before today)." }),
    targetTotalMin: minutes.meta({ description: "Target of the whole range." }),
    workedMin: minutes.meta({ description: "Worked time of every day, today included." }),
    workedCompleteMin: minutes.meta({ description: "Worked time of complete days (before today)." }),
    todayWorkedMin: minutes.meta({ description: "Worked so far today; 0 when today is outside the range." }),
    todayTargetMin: minutes.meta({ description: "Target of today; 0 when today is outside the range." }),
    creditMin: minutes,
    deltaMin: minutes.meta({ description: "Difference of complete days (before today)." }),
    vacationDays: z.number(),
    workdays: z.number().int(),
    sundayWorkMin: minutes,
    holidayWorkMin: minutes,
    nightWorkMin: minutes,
    surchargeMin: minutes,
    nightCreditMin: minutes,
  }),
)

export const DaysResult = named(
  "Days",
  z.object({
    user: z.object({ id, name: z.string(), timezone: z.string() }),
    from: day,
    to: day,
    days: z.array(Day),
    summary: Summary,
  }),
)

export const Balance = named(
  "Balance",
  z.object({
    userId: id,
    balanceMin: minutes.meta({ description: "Overtime balance through `asOf`." }),
    todayDeltaMin: minutes,
    asOf: day,
  }),
)

export const Adjustment = z.object({
  id,
  account: z.enum(["time", "vacation"]),
  amount: z.number(),
  effectiveDate: day,
  kind: z.string(),
  reason: z.string(),
  createdAt: instant,
})

export const Vacation = named(
  "Vacation",
  z.object({
    userId: id,
    year: z.number().int(),
    carriedOver: z.number(),
    entitlement: z.number(),
    adjustments: z.number(),
    taken: z.number(),
    planned: z.number(),
    pending: z.number(),
    remaining: z.number(),
    remainingAfterPending: z.number(),
    adjustmentItems: z.array(Adjustment),
  }),
)

export const Holiday = z.object({
  date: day,
  name: z.string().meta({ description: "English name; the web app translates it." }),
  fraction: z.number().meta({ description: "1 = full day, 0.5 = afternoon." }),
})

export const Holidays = named(
  "Holidays",
  z.object({
    userId: id,
    year: z.number().int(),
    source: z.enum(["user", "team", "default"]).nullable().meta({
      description: "Where the calendar comes from: assigned to the person, their team, or the company default.",
    }),
    calendar: z.object({ id, name: z.string(), regionCode: z.string(), isDefault: z.boolean() }).nullable(),
    team: z.object({ id, name: z.string() }).nullable(),
    years: z.array(z.number().int()).meta({ description: "Years with holidays, plus this and next year." }),
    items: z.array(Holiday),
  }),
)

// ------------------------------------------------------------------ absences

export const AbsenceType = named(
  "AbsenceType",
  z.object({
    id,
    key: z.string(),
    label: z.string(),
    color: z.string(),
    category: z.enum(["vacation", "sick", "other"]),
    creditsTime: z.boolean(),
    deductsVacation: z.boolean(),
    requiresApproval: z.boolean(),
    allowsAttachments: z.boolean(),
    requestable: z.boolean().meta({ description: "The key's owner may request this type." }),
  }),
)

export const Absence = named(
  "Absence",
  z.object({
    id,
    user: UserRef,
    type: z.object({ id, key: z.string(), label: z.string(), category: z.enum(["vacation", "sick", "other"]) }),
    startDate: day,
    endDate: day,
    startHalf: z.enum(["full", "am", "pm"]),
    endHalf: z.enum(["full", "am", "pm"]),
    days: z.number(),
    note: z.string(),
    status: z.enum(["pending", "approved", "rejected", "cancelled"]),
    decidedBy: UserRef.nullable(),
    decidedAt: instant.nullable(),
    decisionNote: z.string(),
    cancelledAt: instant.nullable(),
    cancelReason: z.string(),
    attachments: z.array(
      z.object({ id, filename: z.string(), contentType: z.string(), size: z.number().int(), createdAt: instant }),
    ),
    createdAt: instant,
  }),
)

// ------------------------------------------------------------------ reports

const TimesheetEntry = z.object({
  kind: z.string(),
  start: z.string().meta({ description: "HH:MM local" }),
  end: z.string().nullable(),
  edited: z.boolean(),
  note: z.string(),
})
const TimesheetProjectTime = z.object({
  project: z.string().nullable(),
  note: z.string(),
  minutes,
  start: z.string().nullable(),
  end: z.string().nullable(),
})

export const Timesheet = named(
  "Timesheet",
  z.object({
    user: z.object({ id, name: z.string(), email: z.string(), team: z.string().nullable(), timezone: z.string() }),
    year: z.number().int(),
    month: z.number().int(),
    days: z.array(Day),
    entries: z.record(z.string(), z.array(TimesheetEntry)).meta({ description: "Per local day." }),
    projectTime: z
      .record(z.string(), z.array(TimesheetProjectTime))
      .meta({ description: "Per local day: time on projects." }),
    summary: Summary,
    balanceBeforeMin: minutes,
    balanceAfterMin: minutes,
    vacation: z.object({
      entitlement: z.number(),
      carriedOver: z.number(),
      taken: z.number(),
      planned: z.number(),
      remaining: z.number(),
    }),
    signoff: z.object({ signedBy: z.string().nullable(), signedAt: instant, seal: z.string() }).nullable(),
  }),
)

// ------------------------------------------------------------------ errors

export const ErrorBody = named(
  "Error",
  z.object({
    error: z.object({
      code: z.string().meta({ examples: ["validation_error"] }),
      message: z.string(),
      fields: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
)
