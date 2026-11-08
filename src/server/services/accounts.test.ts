import { describe, expect, it } from "vitest"
import { rawSqlite } from "@/server/db"
import type { Absence, AbsenceType, Holiday, User, WorkSchedule } from "@/server/db/schema"
import { freeze, localToInstant } from "@/server/time"
import {
  loadActor,
  lockMonth,
  makeAbsenceRow,
  makeAbsenceType,
  makeCalendar,
  makeEntry,
  makeLead,
  makeSchedule,
  makeTeam,
  makeUser,
  withSettings,
} from "@/test/factories"
import {
  type AccountContext,
  absenceHalves,
  accountStart,
  type ContextEntry,
  computeDays,
  computeDaysFrom,
  countAbsenceDays,
  createAdjustment,
  deleteAdjustment,
  firstAccountYear,
  setEntitlement,
  summarize,
  timeBalance,
  timeStatement,
  vacationAccount,
  workdaysFactor,
} from "./accounts"
import { listNotifications } from "./notifications"
import { DEFAULTS, type Settings } from "./settings"
import { buildTimeline } from "./timeline"

const TZ = "Europe/Zurich"
const MON = "2026-11-02"
const NOW = "2026-12-31T23:00:00Z"
const at = (day: string, hhmm: string, tz = TZ) => localToInstant(day, hhmm, tz)
const plus = (d: string, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString()

const VACATION = {
  id: 1,
  key: "vacation",
  label: "Vacation",
  color: "#111111",
  category: "vacation",
  creditsTime: true,
  deductsVacation: true,
} as AbsenceType
const SICK = {
  id: 2,
  key: "sick",
  label: "Sick",
  color: "#222222",
  category: "sick",
  creditsTime: true,
  deductsVacation: false,
} as AbsenceType
const COMP = {
  id: 3,
  key: "comp",
  label: "Time off",
  color: "#333333",
  category: "other",
  creditsTime: false,
  deductsVacation: false,
} as AbsenceType

const fakeUser = (o: Partial<User> = {}) =>
  ({
    id: 1,
    timezone: TZ,
    employmentStart: "2026-01-01",
    employmentEnd: null,
    vacationDaysPerYear: 25,
    recordingMode: "full",
    ...o,
  }) as User

function sched(o: { validFrom?: string; perDay?: number; pensum?: number; days?: number[] } = {}): WorkSchedule {
  const days = o.days ?? [0, 1, 2, 3, 4]
  const m = (i: number) => (days.includes(i) ? (o.perDay ?? 504) : 0)
  return {
    id: 1,
    userId: 1,
    validFrom: o.validFrom ?? "2026-01-01",
    pensumPercent: o.pensum ?? 100,
    minutesMon: m(0),
    minutesTue: m(1),
    minutesWed: m(2),
    minutesThu: m(3),
    minutesFri: m(4),
    minutesSat: m(5),
    minutesSun: m(6),
    createdAt: "",
  }
}

let eid = 0
const NO_PROJECT = { projectId: null }
function entry(
  day: string,
  start: string,
  end: string | null,
  kind: "work" | "break" = "work",
  tz = TZ,
  project: Pick<ContextEntry, "projectId"> = NO_PROJECT,
): ContextEntry {
  const s = at(day, start, tz)
  let e = end ? at(day, end, tz) : null
  if (e && e <= s) e = at(plus(day, 1), end!, tz)
  return { id: ++eid, kind, startAt: s, endAt: e, source: "clock", ...project }
}

function absence(
  start: string,
  end = start,
  type = VACATION,
  sh = "full",
  eh = "full",
  status = "approved",
  id = 1,
): Absence {
  return {
    id,
    userId: 1,
    typeId: type.id,
    startDate: start,
    endDate: end,
    startHalf: sh,
    endHalf: eh,
    status,
  } as Absence
}

function ctx(
  start: string,
  end: string,
  o: {
    user?: User
    schedules?: WorkSchedule[]
    holidays?: { date: string; name: string; fraction: number }[]
    absences?: Absence[]
    entries?: ContextEntry[]
    now?: string
    settings?: Partial<Settings>
  } = {},
): AccountContext {
  const now = Temporal.Instant.from(o.now ?? NOW)
  const user = o.user ?? fakeUser()
  const settings = { ...DEFAULTS, ...o.settings }
  return {
    user,
    start,
    end,
    tz: TZ,
    schedules: o.schedules ?? [sched()],
    holidays: new Map((o.holidays ?? []).map((h) => [h.date, h as Holiday])),
    absences: o.absences ?? [],
    types: new Map([VACATION, SICK, COMP].map((t) => [t.id, t])),
    entries: o.entries ?? [],
    settings,
    settingsAt: () => settings,
    settingChanges: [],
    timeline: buildTimeline(user),
    nowMs: now.epochMilliseconds,
    today: now.toZonedDateTimeISO(TZ).toPlainDate().toString(),
  }
}

const one = (c: AccountContext) => {
  const days = computeDaysFrom(c)
  expect(days).toHaveLength(1)
  return days[0]
}

describe("halves", () => {
  it("covers single and multi-day absences", () => {
    expect(absenceHalves(absence(MON), MON)).toEqual(["am", "pm"])
    expect(absenceHalves(absence(MON, MON, VACATION, "am"), MON)).toEqual(["am"])
    const a = absence(MON, plus(MON, 2), VACATION, "pm", "am")
    expect(absenceHalves(a, MON)).toEqual(["pm"])
    expect(absenceHalves(a, plus(MON, 1))).toEqual(["am", "pm"])
    expect(absenceHalves(a, plus(MON, 2))).toEqual(["am"])
    expect(absenceHalves(a, plus(MON, 3))).toEqual([])
  })
})

describe("targets", () => {
  it("regular workday", () => {
    const d = one(ctx(MON, MON, { entries: [entry(MON, "08:00", "12:00"), entry(MON, "12:30", "16:54")] }))
    expect(d).toMatchObject({ scheduledMin: 504, targetMin: 504, workedMin: 504, breakMin: 30, deltaMin: 0 })
    expect(d.firstStart).toBe("2026-11-02T07:00:00.000Z")
  })

  it("weekend work is overtime, a missing day a deficit, future days have no delta", () => {
    const sat = plus(MON, 5)
    expect(one(ctx(sat, sat, { entries: [entry(sat, "09:00", "11:00")] }))).toMatchObject({
      targetMin: 0,
      deltaMin: 120,
      isWorkday: false,
    })
    expect(one(ctx(MON, MON)).deltaMin).toBe(-504)
    const f = one(ctx(MON, MON, { now: "2026-11-01T12:00:00Z" }))
    expect(f).toMatchObject({ isFuture: true, deltaMin: 0, targetMin: 504 })
  })

  it("outside employment and schedule versions", () => {
    expect(one(ctx(MON, MON, { user: fakeUser({ employmentStart: plus(MON, 1) }) }))).toMatchObject({
      scheduledMin: 0,
      deltaMin: 0,
      employed: false,
    })
    expect(one(ctx(MON, MON, { user: fakeUser({ employmentEnd: plus(MON, -1) }) })).scheduledMin).toBe(0)
    const days = computeDaysFrom(
      ctx(MON, plus(MON, 1), { schedules: [sched(), sched({ validFrom: plus(MON, 1), perDay: 403, pensum: 80 })] }),
    )
    expect(days.map((d) => d.scheduledMin)).toEqual([504, 403])
  })
})

const holiday = (fraction = 1, date = MON) => [{ date, name: "X", fraction }]

describe("holidays", () => {
  it("full and half holidays", () => {
    expect(one(ctx(MON, MON, { holidays: holiday() }))).toMatchObject({
      holidayCreditMin: 504,
      targetMin: 0,
      deltaMin: 0,
    })
    expect(one(ctx(MON, MON, { holidays: holiday(0.5), entries: [entry(MON, "08:00", "12:12")] }))).toMatchObject({
      targetMin: 252,
      deltaMin: 0,
    })
    const sat = plus(MON, 5)
    expect(one(ctx(sat, sat, { holidays: holiday(1, sat) }))).toMatchObject({ holidayCreditMin: 0, deltaMin: 0 })
  })

  it("scheduled mode gives a part-timer nothing on a free day", () => {
    const s = sched({ pensum: 80, days: [1, 2, 3, 4] })
    expect(one(ctx(MON, MON, { schedules: [s], holidays: holiday() }))).toMatchObject({
      holidayCreditMin: 0,
      deltaMin: 0,
    })
  })

  it("prorata mode credits pensum x full-time day on any weekday", () => {
    const s = sched({ pensum: 80, days: [1, 2, 3, 4] })
    const d = one(ctx(MON, MON, { schedules: [s], holidays: holiday(), settings: { holiday_mode: "prorata" } }))
    expect(d.holidayCreditMin).toBeCloseTo(403.2)
    expect(d.extraCreditMin).toBeCloseTo(403.2)
    expect(d.deltaMin).toBeCloseTo(403.2)
    const w = one(
      ctx(MON, MON, {
        schedules: [sched({ pensum: 80, days: [0, 1, 2, 3] })],
        holidays: holiday(),
        settings: { holiday_mode: "prorata" },
      }),
    )
    expect(w.targetMin).toBeCloseTo(504 - 403.2)
    expect(w.deltaMin).toBeCloseTo(-(504 - 403.2))
  })

  it("work on a holiday counts fully plus the surcharge in time-credit mode", () => {
    const d = one(
      ctx(MON, MON, {
        holidays: holiday(),
        entries: [entry(MON, "08:00", "10:00")],
        settings: { holiday_work_surcharge_percent: 50, holiday_work_surcharge_mode: "time_credit" },
      }),
    )
    expect(d).toMatchObject({ targetMin: 0, holidayWorkMin: 120, surchargeMin: 60, deltaMin: 180 })
    // payroll mode (the legal default) only reports the hours
    const p = one(ctx(MON, MON, { holidays: holiday(), entries: [entry(MON, "08:00", "10:00")] }))
    expect(p).toMatchObject({ holidayWorkMin: 120, surchargeMin: 0, deltaMin: 120 })
    // a half-day holiday covers the afternoon only
    const half = one(ctx(MON, MON, { holidays: holiday(0.5), entries: [entry(MON, "11:00", "14:00")] }))
    expect(half.holidayWorkMin).toBe(120)
  })
})

describe("Sunday, holiday and night work", () => {
  const SAT = plus(MON, 5)
  const SUN = plus(MON, 6)
  const credit = { holiday_work_surcharge_percent: 50, holiday_work_surcharge_mode: "time_credit" as const }

  it("counts the legal windows: Saturday 23:00 to Sunday 23:00, 23:00 to 06:00", () => {
    const days = computeDaysFrom(
      ctx(SAT, SUN, { entries: [entry(SAT, "22:00", "02:00"), entry(SUN, "22:00", "23:30")], settings: credit }),
    )
    expect(days[0]).toMatchObject({ sundayWorkMin: 60, nightWorkMin: 60, surchargeMin: 30 })
    expect(days[1]).toMatchObject({ sundayWorkMin: 180, nightWorkMin: 150, surchargeMin: 90 })
    // in time-credit mode the surcharge applies to the Sunday window too
    expect(summarize(days)).toMatchObject({ sundayWorkMin: 240, nightWorkMin: 210, surchargeMin: 120 })
  })

  it("counts a holiday on a Sunday once, as holiday work", () => {
    const d = one(
      ctx(SUN, SUN, { settings: credit, holidays: holiday(1, SUN), entries: [entry(SUN, "09:00", "12:00")] }),
    )
    expect(d).toMatchObject({ sundayWorkMin: 0, holidayWorkMin: 180 })
    expect(d.surchargeMin).toBe(90)
  })

  it("credits 10 % of night work for regular night workers where the ArG applies", () => {
    const night = [entry(MON, "22:00", "06:00")]
    const regular = fakeUser({ regularNightWork: true, argExempt: false })
    const d = one(ctx(MON, MON, { user: regular, entries: night }))
    expect(d).toMatchObject({ nightWorkMin: 60, nightCreditMin: 6 })
    expect(d.deltaMin).toBeCloseTo(d.workedMin - d.targetMin + 6)
    expect(one(ctx(MON, MON, { entries: night })).nightCreditMin).toBe(0)
    expect(one(ctx(MON, MON, { user: { ...regular, argExempt: true }, entries: night })).nightCreditMin).toBe(0)
    const off = one(ctx(MON, MON, { user: regular, entries: night, settings: { compliance_enabled: false } }))
    expect(off.nightCreditMin).toBe(0)
  })

  it("never credits a time surcharge to senior executives", () => {
    const exec = fakeUser({ argExempt: true })
    const d = one(ctx(SUN, SUN, { user: exec, entries: [entry(SUN, "09:00", "11:00")], settings: credit }))
    expect(d).toMatchObject({ sundayWorkMin: 120, surchargeMin: 0 })
  })
})

describe("absences", () => {
  it("vacation credits and counts, half days, holidays and weekends are not deducted", () => {
    expect(one(ctx(MON, MON, { absences: [absence(MON)] }))).toMatchObject({
      absenceCreditMin: 504,
      targetMin: 0,
      vacationDays: 1,
    })
    const half = one(
      ctx(MON, MON, { absences: [absence(MON, MON, VACATION, "am")], entries: [entry(MON, "13:00", "17:12")] }),
    )
    expect(half).toMatchObject({ vacationDays: 0.5, targetMin: 252, deltaMin: 0 })
    expect(
      one(ctx(MON, MON, { absences: [absence(MON)], holidays: [{ date: MON, name: "X", fraction: 1 }] })).vacationDays,
    ).toBe(0)
    const week = computeDaysFrom(ctx(MON, plus(MON, 6), { absences: [absence(MON, plus(MON, 6))] }))
    expect(week.reduce((s, d) => s + d.vacationDays, 0)).toBe(5)
  })

  it("half-day holiday and half-day vacation overlap", () => {
    const eve = [{ date: MON, name: "Eve", fraction: 0.5 }]
    expect(one(ctx(MON, MON, { absences: [absence(MON, MON, VACATION, "pm")], holidays: eve })).vacationDays).toBe(0)
    expect(one(ctx(MON, MON, { absences: [absence(MON)], holidays: eve }))).toMatchObject({
      vacationDays: 0.5,
      targetMin: 0,
    })
    const amOnEve = one(ctx(MON, MON, { absences: [absence(MON, MON, VACATION, "am")], holidays: eve }))
    expect(amOnEve).toMatchObject({ vacationDays: 0.5, targetMin: 0, deltaMin: 0 })
  })

  it("pending has no effect, sick credits, time off in lieu consumes balance, two halves add up", () => {
    const p = one(ctx(MON, MON, { absences: [absence(MON, MON, VACATION, "full", "full", "pending")] }))
    expect(p).toMatchObject({ targetMin: 504, vacationDays: 0 })
    expect(p.absences[0].status).toBe("pending")
    expect(one(ctx(MON, MON, { absences: [absence(MON, MON, SICK)] }))).toMatchObject({
      targetMin: 0,
      deltaMin: 0,
      vacationDays: 0,
    })
    expect(one(ctx(MON, MON, { absences: [absence(MON, MON, COMP)] }))).toMatchObject({
      targetMin: 504,
      deltaMin: -504,
    })
    const two = one(
      ctx(MON, MON, {
        absences: [
          absence(MON, MON, SICK, "am", "full", "approved", 1),
          absence(MON, MON, VACATION, "pm", "full", "approved", 2),
        ],
      }),
    )
    expect(two).toMatchObject({ targetMin: 0, vacationDays: 0.5 })
  })
})

describe("sick after part of the day", () => {
  it("credits only what the schedule still lacks", () => {
    const c = () => ctx(MON, MON, { entries: [entry(MON, "08:00", "10:00")], absences: [absence(MON, MON, SICK)] })
    expect(one(c())).toMatchObject({ workedMin: 120, absenceCreditMin: 384, targetMin: 120, deltaMin: 0 })
    // a full day of work and sick: nothing to credit
    const full = ctx(MON, MON, { entries: [entry(MON, "08:00", "17:00")], absences: [absence(MON, MON, SICK)] })
    expect(one(full)).toMatchObject({ absenceCreditMin: 0, deltaMin: 36 })
  })
})

describe("entries", () => {
  it("splits at midnight, counts running entries until now, separates breaks, warns on short breaks", () => {
    expect(
      computeDaysFrom(ctx(MON, plus(MON, 1), { entries: [entry(MON, "22:00", "02:00")] })).map((d) => d.workedMin),
    ).toEqual([120, 120])
    const r = one(ctx(MON, MON, { entries: [entry(MON, "08:00", null)], now: "2026-11-02T09:00:00Z" }))
    expect(r).toMatchObject({ running: true, workedMin: 120 })
    const b = one(
      ctx(MON, MON, {
        entries: [entry(MON, "08:00", "12:00"), entry(MON, "12:00", "12:30", "break"), entry(MON, "12:30", "17:00")],
      }),
    )
    expect(b).toMatchObject({ workedMin: 510, breakMin: 30 })
    expect(one(ctx(MON, MON, { entries: [entry(MON, "08:00", "16:00")] })).warnings).toContain("break_too_short")
    expect(
      one(ctx(MON, MON, { entries: [entry(MON, "08:00", "12:00"), entry(MON, "12:30", "16:30")] })).warnings,
    ).toEqual([])
  })

  it("handles DST days in Europe/Zurich (23 h and 25 h)", () => {
    const spring = "2026-03-29"
    expect(
      one(
        ctx(spring, spring, {
          entries: [
            {
              id: 1,
              kind: "work",
              startAt: at(spring, "00:00"),
              endAt: at(spring, "06:00"),
              source: "clock",
              ...NO_PROJECT,
            },
          ],
        }),
      ).workedMin,
    ).toBe(300)
    const fall = "2026-10-25"
    expect(
      one(
        ctx(fall, fall, {
          entries: [
            {
              id: 2,
              kind: "work",
              startAt: at(fall, "00:00"),
              endAt: at(fall, "06:00"),
              source: "clock",
              ...NO_PROJECT,
            },
          ],
        }),
      ).workedMin,
    ).toBe(420)
    const full = one(
      ctx(fall, fall, {
        entries: [
          {
            id: 3,
            kind: "work",
            startAt: at(fall, "00:00"),
            endAt: at(plus(fall, 1), "00:00"),
            source: "clock",
            ...NO_PROJECT,
          },
        ],
      }),
    )
    expect(full.workedMin).toBe(25 * 60)
  })

  it("respects the person's timezone", () => {
    const ny = "America/New_York"
    const c = {
      ...ctx(MON, plus(MON, 1), {
        user: fakeUser({ timezone: ny }),
        entries: [entry(MON, "23:00", "23:30", "work", ny)],
      }),
      tz: ny,
    }
    expect(computeDaysFrom(c).map((d) => d.workedMin)).toEqual([30, 0])
  })

  it("project requirement per day", () => {
    const P = { projectId: 1 }
    const tagged = entry(MON, "08:00", "10:00", "work", TZ, P)
    const untagged = entry(MON, "10:00", "12:00")
    const required = { project_mode: "required" as const }
    expect(one(ctx(MON, MON, { entries: [tagged, untagged], settings: required }))).toMatchObject({
      projectMin: 120,
      projectOk: false,
    })
    expect(one(ctx(MON, MON, { entries: [tagged, untagged] })).projectOk).toBe(true)
    const other = entry(MON, "10:00", "12:00", "work", TZ, { projectId: 2 })
    expect(one(ctx(MON, MON, { entries: [tagged, other], settings: required }))).toMatchObject({
      projectMin: 240,
      projectOk: true,
    })
    // exact: even a minute without a project leaves the day open
    const minute = entry(MON, "12:00", "12:01")
    expect(one(ctx(MON, MON, { entries: [tagged, other, minute], settings: required })).projectOk).toBe(false)
    // today is never flagged
    const today = ctx(MON, MON, { entries: [untagged], settings: required, now: `${MON}T15:00:00Z` })
    expect(one(today).projectOk).toBe(true)
  })
})

it("summarize", () => {
  const days = computeDaysFrom(
    ctx(MON, plus(MON, 6), { entries: [entry(MON, "08:00", "17:24")], absences: [absence(plus(MON, 1))] }),
  )
  const s = summarize(days)
  expect(s).toMatchObject({ workdays: 5, vacationDays: 1, workedMin: 564, deltaMin: 564 - 504 - 3 * 504 })
})

describe("summarize with today in the range", () => {
  // Thu 2026-11-05 10:42 Zurich: 2:42 worked so far today
  const NOW_THU = "2026-11-05T09:42:00Z"
  const THU = plus(MON, 3)
  const week = () =>
    computeDaysFrom(
      ctx(MON, plus(MON, 6), {
        now: NOW_THU,
        entries: [entry(MON, "08:00", "17:24"), entry(plus(MON, 1), "08:00", "16:24"), entry(THU, "08:00", "10:42")],
      }),
    )

  it("marks only today", () => {
    expect(week().map((d) => d.isToday)).toEqual([false, false, false, true, false, false, false])
  })

  it("target and delta cover complete days; today and the whole period are separate", () => {
    const s = summarize(week())
    expect(s).toMatchObject({
      targetMin: 3 * 504,
      workedCompleteMin: 564 + 504,
      deltaMin: 564 + 504 - 3 * 504,
      todayWorkedMin: 162,
      todayTargetMin: 504,
      workedMin: 564 + 504 + 162,
      targetTotalMin: 5 * 504,
    })
  })

  it("a range without today is unchanged", () => {
    const past = computeDaysFrom(ctx(MON, plus(MON, 6), { entries: [entry(MON, "08:00", "17:24")] }))
    expect(past.some((d) => d.isToday)).toBe(false)
    const s = summarize(past)
    expect(s).toMatchObject({
      targetMin: 5 * 504,
      workedMin: 564,
      workedCompleteMin: 564,
      deltaMin: 564 - 5 * 504,
      todayWorkedMin: 0,
      todayTargetMin: 0,
    })
  })
})

function setup() {
  freeze("2026-11-05T14:00:00Z") // Thu 15:00 Zurich
  makeCalendar({}, [{ date: "2026-01-01", name: "New Year" }])
  const u = makeUser({ employmentStart: "2026-01-01" })
  makeSchedule(u.id, { validFrom: "2026-01-01" })
  return u
}

describe("accounts with the database", () => {
  it("balance and statement agree; the statement starts at the account start", () => {
    const u = setup()
    makeEntry(u.id, at("2026-11-02", "08:00"), at("2026-11-02", "17:24"))
    const bal = timeBalance(u)
    expect(bal.asOf).toBe("2026-11-04")
    const st = timeStatement(u, 2026)
    expect(st.openingMin).toBe(0)
    expect(st.months).toHaveLength(11)
    expect(st.months[0].targetMin).toBe(21 * 504)
    expect(st.closingMin).toBe(bal.balanceMin)
    expect(accountStart(u)).toBe("2026-01-01")
  })

  it("bookings: none after an as-of date, months before the start and years before the hire still count", () => {
    const u = setup()
    const hr = loadActor(makeUser({ capabilities: ["hr"] }).id)
    const october = timeBalance(u, "2026-10-31").balanceMin
    createAdjustment(hr, u.id, { account: "time", amount: -600, reason: "Payout", effectiveDate: "2026-11-03" })
    expect(timeBalance(u, "2026-10-31").balanceMin).toBe(october)
    expect(timeBalance(u).balanceMin).toBe(timeBalance(u, "2026-11-04").balanceMin)

    const late = makeUser({ employmentStart: "2026-03-15" })
    makeSchedule(late.id, { validFrom: "2026-03-15" })
    createAdjustment(hr, late.id, { account: "time", amount: 600, reason: "Opening", effectiveDate: "2026-01-01" })
    expect(timeStatement(late, 2026).closingMin).toBe(timeBalance(late).balanceMin)

    const hire = makeUser({ employmentStart: "2027-01-01", vacationDaysPerYear: 25 })
    makeSchedule(hire.id, { validFrom: "2027-01-01" })
    createAdjustment(hr, hire.id, { account: "vacation", amount: 3, reason: "Carry-over" })
    expect(vacationAccount(hire, 2027)).toMatchObject({ carriedOver: 3, remaining: 28 })
  })

  it("first year: the account start, an earlier booking, never before what a lead may see", () => {
    setup()
    const hr = loadActor(makeUser({ capabilities: ["hr"] }).id)
    const u = makeUser({ employmentStart: "2026-03-15" })
    expect(firstAccountYear(u)).toBe(2026)
    createAdjustment(hr, u.id, { account: "time", amount: 600, reason: "Opening", effectiveDate: "2025-12-31" })
    expect(firstAccountYear(u)).toBe(2025)
    expect(firstAccountYear(u, "2026-06-01")).toBe(2026)
  })

  it("adjustments: permission, reason, notification, revisions, sign-off lock (service and trigger)", () => {
    const u = setup()
    const team = makeTeam()
    const lead = makeUser()
    makeLead(team.id, lead.id)
    const member = makeUser({ teamId: team.id, employmentStart: "2026-01-01" })
    const hr = makeUser({ capabilities: ["hr"] })
    const admin = makeUser({ role: "admin" })
    const before = timeBalance(u).balanceMin
    expect(() => createAdjustment(loadActor(u.id), u.id, { account: "time", amount: 600, reason: "gift" })).toThrow(
      /Not allowed/,
    )
    expect(() => createAdjustment(loadActor(admin.id), u.id, { account: "time", amount: 600, reason: "x" })).toThrow(
      /not found/i,
    )
    expect(() => createAdjustment(loadActor(hr.id), u.id, { account: "time", amount: 600, reason: " " })).toThrow(
      /reason/,
    )
    expect(() => createAdjustment(loadActor(hr.id), u.id, { account: "time", amount: 0, reason: "x" })).toThrow(/zero/)
    const adj = createAdjustment(loadActor(hr.id), u.id, {
      account: "time",
      amount: 600,
      kind: "opening",
      reason: "Carry-over",
      effectiveDate: "2026-01-01",
    })
    expect(timeBalance(u).balanceMin).toBe(before + 600)
    expect(listNotifications(u.id)[0].kind).toBe("balance_adjusted")
    expect(timeStatement(u, 2026).adjustments[0]).toMatchObject({
      id: adj.id,
      kind: "opening",
      createdBy: expect.any(String),
    })

    expect(
      createAdjustment(loadActor(lead.id), member.id, { account: "vacation", amount: 2, reason: "Bonus" }).amount,
    ).toBe(2)
    withSettings({ lead_can_adjust_balances: false })
    expect(() => createAdjustment(loadActor(lead.id), member.id, { account: "time", amount: 60, reason: "x" })).toThrow(
      /Not allowed/,
    )

    lockMonth(u.id, "2026-01")
    expect(() => deleteAdjustment(loadActor(hr.id), adj.id, "wrong")).toThrow(
      expect.objectContaining({ code: "period_signed_off" }),
    )
    expect(() =>
      createAdjustment(loadActor(hr.id), u.id, {
        account: "time",
        amount: 5,
        reason: "x",
        effectiveDate: "2026-01-15",
      }),
    ).toThrow(expect.objectContaining({ code: "period_signed_off" }))
    expect(() => rawSqlite().prepare("UPDATE balance_adjustments SET is_deleted = 1 WHERE id = ?").run(adj.id)).toThrow(
      /period signed off/,
    )

    const later = createAdjustment(loadActor(hr.id), u.id, {
      account: "time",
      amount: 30,
      reason: "x",
      effectiveDate: "2026-03-01",
    })
    expect(() => deleteAdjustment(loadActor(hr.id), later.id, "")).toThrow(/reason/)
    deleteAdjustment(loadActor(hr.id), later.id, "typo")
    const revs = rawSqlite()
      .prepare("SELECT action FROM revisions WHERE entity = 'adjustment' AND entity_id = ? ORDER BY id")
      .all(later.id)
    expect(revs).toEqual([{ action: "create" }, { action: "delete" }])
  })

  it("vacation account: carry-over, overrides, pending, working days, rounding up", () => {
    freeze("2026-06-15T10:00:00Z")
    const vac = makeAbsenceType({ key: "vacation", category: "vacation", deductsVacation: true })
    const u = makeUser({ employmentStart: "2025-07-01", vacationDaysPerYear: 25 })
    makeSchedule(u.id, { validFrom: "2025-07-01" })
    makeAbsenceRow(u.id, vac.id, "2025-08-04", "2025-08-08")
    makeAbsenceRow(u.id, vac.id, "2026-03-02", "2026-03-03")
    makeAbsenceRow(u.id, vac.id, "2026-08-03", "2026-08-07")
    makeAbsenceRow(u.id, vac.id, "2026-09-07", "2026-09-07", { status: "pending" })
    const v25 = vacationAccount(u, 2025)
    // 25 x 184/365 = 12.6, rounded up to the next half day
    expect(v25).toMatchObject({ entitlement: 13, taken: 5, remaining: 8 })
    const v26 = vacationAccount(u, 2026)
    expect(v26).toMatchObject({
      carriedOver: 8,
      entitlement: 25,
      taken: 2,
      planned: 5,
      pending: 1,
      remaining: 26,
      remainingAfterPending: 25,
    })
    const hr = makeUser({ capabilities: ["hr"] })
    setEntitlement(loadActor(hr.id), u.id, 2026, 20, "contract")
    expect(vacationAccount(u, 2026)).toMatchObject({ entitlement: 20, entitlementOverridden: true })
    setEntitlement(loadActor(hr.id), u.id, 2026, null)
    expect(vacationAccount(u, 2026).entitlementOverridden).toBe(false)
    expect(vacationAccount(u, 2024)).toMatchObject({ entitlement: 0, remaining: 0 })

    const part = makeUser({ employmentStart: "2026-01-01", vacationDaysPerYear: 25 })
    makeSchedule(part.id, { validFrom: "2026-01-01", minutesThu: 0, minutesFri: 0 })
    expect(vacationAccount(part, 2026).entitlement).toBe(15)
    expect(workdaysFactor([], "2026-01-01", "2026-01-31")).toBe(1)
  })

  it("countAbsenceDays skips weekends and holidays", () => {
    const u = setup()
    const cal = makeCalendar({ name: "Own", isDefault: false }, [{ date: "2026-12-24", name: "Eve", fraction: 0.5 }])
    const own = makeUser({ employmentStart: "2026-01-01", holidayCalendarId: cal.id })
    makeSchedule(own.id, { validFrom: "2026-01-01" })
    expect(countAbsenceDays(u, "2026-11-02", "2026-11-08", "full", "full")).toBe(5)
    expect(countAbsenceDays(u, "2026-11-02", "2026-11-03", "pm", "am")).toBe(1)
    expect(countAbsenceDays(own, "2026-12-24", "2026-12-24", "full", "full")).toBe(0.5)
    expect(countAbsenceDays(u, "2026-01-01", "2026-01-02", "full", "full")).toBe(1)
  })

  it("computeDays loads absences, holidays and a long-running open entry", () => {
    const u = setup()
    const vac = makeAbsenceType({ key: "vacation", deductsVacation: true })
    makeAbsenceRow(u.id, vac.id, "2026-11-03")
    makeEntry(u.id, at("2026-11-03", "08:00"), null, { source: "clock", ...NO_PROJECT })
    const days = computeDays(u, "2026-11-02", "2026-11-05")
    expect(days[1].absences[0]).toMatchObject({ typeKey: "vacation", halves: ["am", "pm"] })
    expect(days[3].running).toBe(true)
    expect(days[3].workedMin).toBe(15 * 60)
  })

  it("balance over three years stays fast", () => {
    freeze("2026-11-05T14:00:00Z")
    const u = makeUser({ employmentStart: "2023-11-01" })
    makeSchedule(u.id, { validFrom: "2023-11-01" })
    const insert = rawSqlite().prepare(
      "INSERT INTO time_entries (user_id, kind, start_at, end_at, source) VALUES (?, ?, ?, ?, 'clock')",
    )
    rawSqlite().transaction(() => {
      for (let d = "2023-11-01"; d < "2026-11-05"; d = plus(d, 1)) {
        if (Temporal.PlainDate.from(d).dayOfWeek > 5) continue
        insert.run(u.id, "work", at(d, "08:00"), at(d, "12:00"))
        insert.run(u.id, "break", at(d, "12:00"), at(d, "12:30"))
        insert.run(u.id, "work", at(d, "12:30"), at(d, "16:54"))
      }
    })()
    timeBalance(u)
    const t0 = performance.now()
    const bal = timeBalance(u)
    const elapsed = performance.now() - t0
    expect(bal.balanceMin).toBe(0)
    expect(elapsed).toBeLessThan(50)
  })
})
