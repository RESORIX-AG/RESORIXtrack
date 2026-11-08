/**
 * Time and vacation accounts (port of v1 services/accounts.py).
 *
 * Each day is split into two halves (am / pm). Half-day public holidays cover the afternoon; absences cover
 * am, pm or both, so overlaps of half-day holidays and half-day absences are unambiguous.
 *
 * Per day:
 *   scheduled       minutes from the versioned work schedule (0 outside the employment period)
 *   holidayCredit   scheduled mode: scheduled x holiday halves / 2
 *                   prorata mode:   pensum x full-time daily minutes x holiday halves / 2 (Mon-Fri)
 *   absenceCredit   scheduled x absence halves not covered by a holiday / 2, for crediting types
 *   target          max(0, scheduled - holidayCredit - absenceCredit)
 *   extraCredit     max(0, holidayCredit + absenceCredit - scheduled)   (prorata only)
 *   sunday/holiday/night work   minutes in the legal windows (ArG Art. 16, 18, 20a): Saturday 23:00 to
 *                   Sunday 23:00, the eve 23:00 to 23:00 on a full holiday (12:00 on a half day), 23:00 to 06:00
 *   surcharge       time_credit mode only: (Sunday + holiday work) x surcharge %
 *   nightCredit     regular night work only: night work x 10 % (Art. 17b para. 2)
 *   delta           worked - target + extraCredit + surcharge + nightCredit (0 for future days)
 *
 * A period is loaded in a handful of indexed queries (`loadContext`) and computed in memory.
 */
import { and, asc, eq, gte, inArray, isNull, lt, lte, min, ne } from "drizzle-orm"
import { db } from "../db"
import {
  type Absence,
  type AbsenceType,
  absences,
  absenceTypes,
  type BalanceAdjustment,
  balanceAdjustments,
  type Holiday,
  type TimeEntry,
  timeEntries,
  type User,
  users,
  vacationEntitlements,
  type WorkSchedule,
  workSchedules,
} from "../db/schema"
import { Forbidden, NotFound, Validation } from "../errors"
import { addDays, instantOfMs, localToday, nowInstant, zone } from "../time"
import { maxDay, minDay } from "./absences.schemas"
import { type Half, holidayHalves, holidaysFor } from "./holidays"
import { ensureOpenDates } from "./locks"
import { notify } from "./notifications"
import { type Actor, beforeCover, canAdjustBalance, requireDate, requireView, seesDate } from "./permissions"
import { record, snapshot } from "./revisions"
import { minutesOnWeekday, schedulesOf, workdaysPerWeek } from "./schedules"
import { type Settings, type SettingsTimeline, settingsTimeline } from "./settings"
import { dayStartsMs, type PersonTimeline, personTimeline } from "./timeline"

export interface DayAbsence {
  id: number
  typeId: number
  typeKey: string
  label: string
  color: string
  category: "vacation" | "sick" | "other"
  status: "pending" | "approved"
  halves: ("am" | "pm")[]
}

export interface Day {
  date: string
  weekday: number // 0 = Monday
  scheduledMin: number
  holiday: { name: string; fraction: number } | null
  holidayCreditMin: number
  absenceCreditMin: number
  targetMin: number
  extraCreditMin: number
  workedMin: number
  breakMin: number
  sundayWorkMin: number
  holidayWorkMin: number
  nightWorkMin: number
  surchargeMin: number
  nightCreditMin: number
  deltaMin: number
  firstStart: string | null
  lastEnd: string | null
  running: boolean
  isWorkday: boolean
  isFuture: boolean
  /** today in the person's timezone: the day is still in progress */
  isToday: boolean
  employed: boolean
  vacationDays: number
  absences: DayAbsence[]
  warnings: string[] // break_too_short | outside_employment (compliance findings come from compliance.ts)
  edited: boolean
  /** Worked minutes with a project. */
  projectMin: number
  /** False on a past day with work without a project while projects are required. */
  projectOk: boolean
}

export interface Summary {
  scheduledMin: number
  targetMin: number // complete days only (before today)
  targetTotalMin: number // whole period
  workedMin: number // every day, today included (live progress)
  workedCompleteMin: number // complete days only, pairs with targetMin and deltaMin
  todayWorkedMin: number // 0 when today is outside the period
  todayTargetMin: number
  creditMin: number
  deltaMin: number // complete days only
  vacationDays: number
  workdays: number
  // complete days only (payroll): work in the Sunday, holiday and night windows, and the time credits for them
  sundayWorkMin: number
  holidayWorkMin: number
  nightWorkMin: number
  surchargeMin: number
  nightCreditMin: number
}

export interface TimeBalance {
  balanceMin: number // through asOf (default: yesterday)
  todayDeltaMin: number
  asOf: string
}

export interface AdjustmentItem {
  id: number
  account: "time" | "vacation"
  amount: number
  effectiveDate: string
  kind: string
  reason: string
  createdBy: string | null
  createdAt: string
}

export interface VacationAccount {
  userId: number
  year: number
  carriedOver: number
  entitlement: number
  adjustments: number
  taken: number
  planned: number
  pending: number
  remaining: number
  remainingAfterPending: number
  entitlementOverridden: boolean
  adjustmentItems: AdjustmentItem[]
}

export interface StatementMonth extends Summary {
  month: number
  adjustmentsMin: number
  balanceMin: number
}

export interface TimeStatement {
  userId: number
  year: number
  openingMin: number
  months: StatementMonth[]
  closingMin: number
  adjustments: AdjustmentItem[]
}

// ------------------------------------------------------------------ calendar arithmetic (fast, UTC based)

const DAY_MS = 86_400_000
const epochDay = (d: string): number => Date.parse(d) / DAY_MS
const dayOfEpoch = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)
const weekdayOfEpoch = (n: number): number => (((n + 3) % 7) + 7) % 7
const r2 = (x: number): number => Math.round(x * 100) / 100

/** Index of the last element <= x (or -1). */
function floorIndex(sorted: number[], x: number): number {
  let lo = 0
  let hi = sorted.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= x) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

// ------------------------------------------------------------------ helpers

/** Which halves of day `d` the absence covers. */
export function absenceHalves(
  a: { startDate: string; endDate: string; startHalf: string; endHalf: string },
  d: string,
): Half[] {
  if (d < a.startDate || d > a.endDate) return []
  if (a.startDate === a.endDate) return a.startHalf === "am" ? ["am"] : a.startHalf === "pm" ? ["pm"] : ["am", "pm"]
  if (d === a.startDate) return a.startHalf === "pm" ? ["pm"] : ["am", "pm"]
  if (d === a.endDate) return a.endHalf === "am" ? ["am"] : ["am", "pm"]
  return ["am", "pm"]
}

function createdDay(user: User): string {
  const ms = user.createdAt instanceof Date ? user.createdAt.getTime() : Number(user.createdAt)
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone(user.timezone)).toPlainDate().toString()
}

/** First day the accounts run from (start of the first employment period, else the first schedule). */
export function accountStart(user: User, timeline: PersonTimeline = personTimeline(user)): string {
  const first = timeline.periods[0].start
  if (first) return first
  const firstSchedule = db
    .select({ d: min(workSchedules.validFrom) })
    .from(workSchedules)
    .where(eq(workSchedules.userId, user.id))
    .get()?.d
  const created = createdDay(user)
  return firstSchedule ? minDay(firstSchedule, created) : created
}

/**
 * Earliest year the accounts hold anything for: the account start or an earlier booking (an opening balance),
 * never before `visibleFrom` (a lead sees their team from the day they took it over).
 */
export function firstAccountYear(user: User, visibleFrom: string | null = null): number {
  const booked = db
    .select({ d: min(balanceAdjustments.effectiveDate) })
    .from(balanceAdjustments)
    .where(and(eq(balanceAdjustments.userId, user.id), eq(balanceAdjustments.isDeleted, false)))
    .get()?.d
  const start = accountStart(user)
  const first = booked ? minDay(booked, start) : start
  return Number((visibleFrom ? maxDay(first, visibleFrom) : first).slice(0, 4))
}

// ------------------------------------------------------------------ data context

export type ContextEntry = Pick<TimeEntry, "id" | "kind" | "startAt" | "endAt" | "source" | "projectId">

export interface AccountContext {
  user: User
  start: string
  end: string
  tz: string
  schedules: WorkSchedule[]
  holidays: Map<string, Holiday>
  absences: Absence[]
  types: Map<number, AbsenceType>
  entries: ContextEntry[]
  /** Today's settings (non-figure keys); `settingsAt` for the figure-changing ones of a day. */
  settings: Settings
  settingsAt: (date: string) => Settings
  /** Days a versioned setting changes on, ascending. */
  settingChanges: readonly string[]
  timeline: PersonTimeline
  nowMs: number
  today: string
}

/** Timelines built once and passed along (a loop over many people builds the settings timeline once). */
export interface Prebuilt {
  timeline?: PersonTimeline
  settings?: SettingsTimeline
}

export interface ContextOptions extends Prebuilt {
  includePending?: boolean
  /** Skip loading time entries (vacation figures only). */
  entries?: boolean
  /** Leave out one absence, e.g. the request being edited in a preview. */
  excludeAbsenceId?: number
}

export function loadContext(user: User, start: string, end: string, opts: ContextOptions = {}): AccountContext {
  const tz = zone(user.timezone)
  const timeline = opts.timeline ?? personTimeline(user)
  const dayTz = timeline.earlier.length ? timeline.tzOn : tz
  const includePending = opts.includePending ?? true
  const states: ("approved" | "pending")[] = includePending ? ["approved", "pending"] : ["approved"]
  const absenceRows = db
    .select()
    .from(absences)
    .where(
      and(
        eq(absences.userId, user.id),
        lte(absences.startDate, end),
        gte(absences.endDate, start),
        inArray(absences.status, states),
        opts.excludeAbsenceId != null ? ne(absences.id, opts.excludeAbsenceId) : undefined,
      ),
    )
    .orderBy(asc(absences.startDate), asc(absences.id))
    .all()
  const types = new Map(
    db
      .select()
      .from(absenceTypes)
      .all()
      .map((t) => [t.id, t]),
  )
  let entries: ContextEntry[] = []
  if (opts.entries !== false) {
    const [startMs] = dayStartsMs(start, 1, dayTz)
    const [endMs] = dayStartsMs(addDays(end, 1), 1, dayTz)
    const eUtc = instantOfMs(endMs)
    // entries never exceed 24 h, so starting a day earlier catches every entry that reaches into the range
    const from = instantOfMs(startMs - DAY_MS)
    entries = db
      .select({
        id: timeEntries.id,
        kind: timeEntries.kind,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        source: timeEntries.source,
        projectId: timeEntries.projectId,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, user.id),
          gte(timeEntries.startAt, from),
          lt(timeEntries.startAt, eUtc),
          eq(timeEntries.isDeleted, false),
        ),
      )
      .orderBy(asc(timeEntries.startAt))
      .all()
    // a running entry may have been started long before (forgotten clock-out); it counts until now
    const open = db
      .select({
        id: timeEntries.id,
        kind: timeEntries.kind,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        source: timeEntries.source,
        projectId: timeEntries.projectId,
      })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, user.id), isNull(timeEntries.endAt), eq(timeEntries.isDeleted, false)))
      .get()
    if (open && open.startAt < from) entries.unshift(open)
  }
  const now = nowInstant()
  const settings = opts.settings ?? settingsTimeline()
  const today = now.toZonedDateTimeISO(tz).toPlainDate().toString()
  return {
    user,
    start,
    end,
    tz,
    schedules: schedulesOf(user.id),
    holidays: holidaysFor(user, start, end, timeline.earlier),
    absences: absenceRows,
    types,
    entries,
    settings: settings.at(today),
    settingsAt: settings.at,
    settingChanges: settings.changes,
    timeline,
    nowMs: now.epochMilliseconds,
    today,
  }
}

// ------------------------------------------------------------------ day computation

interface Segment<E = ContextEntry> {
  a: number
  b: number
  e: E
}

export interface ComputeOptions {
  editedEntryIds?: ReadonlySet<number>
  /** Keep full precision (balances); the default rounds minutes to 2 decimals for display. */
  raw?: boolean
}

/** Splits entries into per-day segments at local midnight. `starts` has one more element than days. */
export function segmentsByDay<E extends Pick<ContextEntry, "startAt" | "endAt">>(
  entries: E[],
  starts: number[],
  nowMs: number,
): Segment<E>[][] {
  const n = starts.length - 1
  const out: Segment<E>[][] = Array.from({ length: n }, () => [])
  for (const e of entries) {
    const s = Date.parse(e.startAt)
    const en = e.endAt ? Date.parse(e.endAt) : nowMs
    if (en <= s) continue
    for (let i = Math.max(0, floorIndex(starts, s)); i < n && starts[i] < en; i++) {
      const a = Math.max(s, starts[i])
      const b = Math.min(en, starts[i + 1])
      if (b > a) out[i].push({ a, b, e })
    }
  }
  return out
}

export function computeDaysFrom(ctx: AccountContext, opts: ComputeOptions = {}): Day[] {
  const { timeline } = ctx
  const e0 = epochDay(ctx.start)
  const n = epochDay(ctx.end) - e0 + 1
  if (!(n > 0)) return []
  const edited = opts.editedEntryIds
  const starts = dayStartsMs(ctx.start, n + 1, timeline.earlier.length ? timeline.tzOn : ctx.tz)
  const segs = segmentsByDay(ctx.entries, starts, ctx.nowMs)

  const absByDay: Absence[][] = Array.from({ length: n }, () => [])
  for (const a of ctx.absences) {
    const from = Math.max(0, epochDay(a.startDate) - e0)
    const to = Math.min(n - 1, epochDay(a.endDate) - e0)
    for (let i = from; i <= to; i++) absByDay[i].push(a)
  }

  const projectsRequired = ctx.settings.project_mode === "required"
  const days: Day[] = []
  let si = -1
  for (let i = 0; i < n; i++) {
    const date = dayOfEpoch(e0 + i)
    const wd = weekdayOfEpoch(e0 + i)
    const st = ctx.settingsAt(date)
    const terms = timeline.termsOn(date)
    const prorata = st.holiday_mode === "prorata"
    const ftDaily = st.fulltime_weekly_minutes / 5
    // the time credit is a company/GAV rule; the night credit a legal one (ArG Art. 17b para. 2)
    const surchargePct =
      st.holiday_work_surcharge_mode === "time_credit" && !terms.argExempt ? st.holiday_work_surcharge_percent || 0 : 0
    const nightCredit = st.compliance_enabled && !terms.argExempt && terms.regularNightWork ? NIGHT_CREDIT : 0
    // breaks are a legal minimum (ArG Art. 15) wherever the ArG applies and start and end times are recorded
    const breakCheck = st.compliance_enabled && !terms.argExempt && terms.recordingMode === "full"
    while (si + 1 < ctx.schedules.length && ctx.schedules[si + 1].validFrom <= date) si++
    const sched = si >= 0 ? ctx.schedules[si] : null
    const employed = timeline.employedOn(date)
    const scheduled = sched && employed ? minutesOnWeekday(sched, wd) : 0
    const pensum = (sched ? sched.pensumPercent : 100) / 100
    const day: Day = {
      date,
      weekday: wd,
      scheduledMin: scheduled,
      holiday: null,
      holidayCreditMin: 0,
      absenceCreditMin: 0,
      targetMin: 0,
      extraCreditMin: 0,
      workedMin: 0,
      breakMin: 0,
      sundayWorkMin: 0,
      holidayWorkMin: 0,
      nightWorkMin: 0,
      surchargeMin: 0,
      nightCreditMin: 0,
      deltaMin: 0,
      firstStart: null,
      lastEnd: null,
      running: false,
      isWorkday: scheduled > 0,
      isFuture: date > ctx.today,
      isToday: date === ctx.today,
      employed,
      vacationDays: 0,
      absences: [],
      warnings: [],
      edited: false,
      projectMin: 0,
      projectOk: true,
    }

    const hol = ctx.holidays.get(date)
    const holH = hol ? holidayHalves(hol.fraction) : []
    if (hol) day.holiday = { name: hol.name, fraction: hol.fraction }
    if (holH.length && employed) {
      day.holidayCreditMin = prorata
        ? wd < 5
          ? (pensum * ftDaily * holH.length) / 2
          : 0
        : (scheduled * holH.length) / 2
    }

    const covered = new Set<Half>(holH)
    let sickCredit = 0
    for (const a of absByDay[i]) {
      const halves = absenceHalves(a, date)
      if (!halves.length) continue
      const t = ctx.types.get(a.typeId)
      const effective = a.status === "approved" ? halves.filter((h) => !covered.has(h)) : []
      day.absences.push({
        id: a.id,
        typeId: a.typeId,
        typeKey: t?.key ?? "",
        label: t?.label ?? "",
        color: t?.color ?? "#888888",
        category: t?.category ?? "other",
        status: a.status === "approved" ? "approved" : "pending",
        halves: [...halves].sort(),
      })
      if (!effective.length || !employed) continue
      for (const h of effective) covered.add(h)
      if (t?.creditsTime && scheduled > 0) {
        const credit = (scheduled * effective.length) / 2
        if (t.category === "sick") sickCredit += credit
        else day.absenceCreditMin += credit
      }
      if (t?.deductsVacation && scheduled > 0) day.vacationDays += effective.length / 2
    }

    const daySegs = segs[i]
    let unassignedMs = 0
    if (daySegs.length) {
      daySegs.sort((x, y) => x.a - y.a)
      let first = Number.POSITIVE_INFINITY
      let last = Number.NEGATIVE_INFINITY
      let workedMs = 0
      let projectMs = 0
      for (const s of daySegs) {
        if (s.e.endAt == null) day.running = true
        if (s.e.source === "manual" || edited?.has(s.e.id)) day.edited = true
        if (s.e.kind !== "work") continue
        workedMs += s.b - s.a
        if (s.e.projectId != null) projectMs += s.b - s.a
        else unassignedMs += s.b - s.a
        if (s.a < first) first = s.a
        if (s.b > last) last = s.b
      }
      day.workedMin = workedMs / 60000
      day.projectMin += projectMs / 60000
      if (workedMs > 0) {
        day.firstStart = new Date(first).toISOString()
        day.lastEnd = new Date(last).toISOString()
        day.breakMin = Math.max(0, (last - first) / 60000 - day.workedMin)
        const w = workWindows(
          daySegs,
          date,
          wd,
          starts[i],
          starts[i + 1],
          terms.timezone,
          hol,
          ctx.holidays.get(addDays(date, 1)),
        )
        day.sundayWorkMin = w.sunday
        day.holidayWorkMin = w.holiday
        day.nightWorkMin = w.night
      }
    }

    // sick after part of the day: only what the schedule still lacks is credited, never more than the day
    if (sickCredit)
      sickCredit = Math.min(
        sickCredit,
        Math.max(0, scheduled - day.holidayCreditMin - day.absenceCreditMin - day.workedMin),
      )
    day.absenceCreditMin += sickCredit
    const credits = day.holidayCreditMin + day.absenceCreditMin
    day.targetMin = Math.max(0, scheduled - credits)
    day.extraCreditMin = Math.max(0, credits - scheduled)
    day.surchargeMin = ((day.sundayWorkMin + day.holidayWorkMin) * surchargePct) / 100
    day.nightCreditMin = day.nightWorkMin * nightCredit
    day.deltaMin = day.isFuture
      ? 0
      : day.workedMin - day.targetMin + day.extraCreditMin + day.surchargeMin + day.nightCreditMin

    if (breakCheck && day.workedMin && breakRequiredMin(day.workedMin) > day.breakMin) {
      day.warnings.push("break_too_short")
    }
    if (day.workedMin > 0 && !employed) day.warnings.push("outside_employment")
    if (projectsRequired && unassignedMs > 0 && date < ctx.today) day.projectOk = false
    days.push(opts.raw ? day : roundDay(day))
  }
  return days
}

const NIGHT_CREDIT = 0.1
const PAY_FIGURES = ["sundayWorkMin", "holidayWorkMin", "nightWorkMin", "surchargeMin", "nightCreditMin"] as const
const fullHoliday = (h: Holiday | undefined) => h != null && h.fraction >= 1

function localHourMs(date: string, hour: number, tz: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz, plainTime: { hour, minute: 0 } })
    .epochMilliseconds
}

/**
 * Work minutes of one day inside the Sunday, public holiday and night windows. A day's 23:00 to midnight
 * belongs to the next day's Sunday or full-holiday window; minutes in both count as holiday work.
 */
function workWindows(
  segs: Segment[],
  date: string,
  wd: number,
  dayStart: number,
  nextStart: number,
  tz: string,
  hol: Holiday | undefined,
  nextHol: Holiday | undefined,
): { sunday: number; holiday: number; night: number } {
  const work = segs.filter((x) => x.e.kind === "work")
  const within = (a: number, b: number) => {
    let ms = 0
    for (const x of work) ms += Math.max(0, Math.min(x.b, b) - Math.max(x.a, a))
    return ms / 60000
  }
  const h6 = localHourMs(date, 6, tz)
  const h23 = localHourMs(date, 23, tz)
  const night = within(dayStart, h6) + within(h23, nextStart)
  let holiday = 0
  let sunday = 0
  if (fullHoliday(hol)) holiday += within(dayStart, h23)
  else if (hol && hol.fraction > 0) {
    const h12 = localHourMs(date, 12, tz)
    holiday += within(h12, h23)
    if (wd === 6) sunday += within(dayStart, h12)
  } else if (wd === 6) sunday += within(dayStart, h23)
  if (fullHoliday(nextHol)) holiday += within(h23, nextStart)
  else if (wd === 5) sunday += within(h23, nextStart)
  return { sunday, holiday, night }
}

/** Minimum break for a day with `workedMin` (ArG Art. 15): 15 min > 5.5 h, 30 min > 7 h, 60 min > 9 h. */
export function breakRequiredMin(workedMin: number): number {
  if (workedMin > 540) return 60
  if (workedMin > 420) return 30
  if (workedMin > 330) return 15
  return 0
}

function roundDay(d: Day): Day {
  d.scheduledMin = r2(d.scheduledMin)
  d.holidayCreditMin = r2(d.holidayCreditMin)
  d.absenceCreditMin = r2(d.absenceCreditMin)
  d.targetMin = r2(d.targetMin)
  d.extraCreditMin = r2(d.extraCreditMin)
  d.workedMin = r2(d.workedMin)
  d.breakMin = r2(d.breakMin)
  d.sundayWorkMin = r2(d.sundayWorkMin)
  d.holidayWorkMin = r2(d.holidayWorkMin)
  d.nightWorkMin = r2(d.nightWorkMin)
  d.surchargeMin = r2(d.surchargeMin)
  d.nightCreditMin = r2(d.nightCreditMin)
  d.deltaMin = r2(d.deltaMin)
  d.projectMin = r2(d.projectMin)
  return d
}

/** Per-day figures for [start, end] (inclusive days, person's timezone). */
export function computeDays(
  user: User,
  start: string,
  end: string,
  opts: { includePending?: boolean; editedEntryIds?: ReadonlySet<number> } = {},
): Day[] {
  return computeDaysFrom(loadContext(user, start, end, { includePending: opts.includePending }), {
    editedEntryIds: opts.editedEntryIds,
  })
}

export function summarize(days: Day[]): Summary {
  let scheduled = 0
  let target = 0
  let targetTotal = 0
  let worked = 0
  let workedComplete = 0
  let todayWorked = 0
  let todayTarget = 0
  let credit = 0
  let delta = 0
  let vacation = 0
  let workdays = 0
  const pay = { sundayWorkMin: 0, holidayWorkMin: 0, nightWorkMin: 0, surchargeMin: 0, nightCreditMin: 0 }
  for (const d of days) {
    scheduled += d.scheduledMin
    targetTotal += d.targetMin
    worked += d.workedMin
    if (d.isToday) {
      todayWorked = d.workedMin
      todayTarget = d.targetMin
    } else if (!d.isFuture) {
      target += d.targetMin
      workedComplete += d.workedMin
      delta += d.deltaMin
      for (const k of PAY_FIGURES) pay[k] += d[k]
    }
    credit += d.holidayCreditMin + d.absenceCreditMin
    vacation += d.vacationDays
    if (d.isWorkday) workdays++
  }
  return {
    scheduledMin: r2(scheduled),
    targetMin: r2(target),
    targetTotalMin: r2(targetTotal),
    workedMin: r2(worked),
    workedCompleteMin: r2(workedComplete),
    todayWorkedMin: r2(todayWorked),
    todayTargetMin: r2(todayTarget),
    creditMin: r2(credit),
    deltaMin: r2(delta),
    vacationDays: r2(vacation),
    workdays,
    sundayWorkMin: r2(pay.sundayWorkMin),
    holidayWorkMin: r2(pay.holidayWorkMin),
    nightWorkMin: r2(pay.nightWorkMin),
    surchargeMin: r2(pay.surchargeMin),
    nightCreditMin: r2(pay.nightCreditMin),
  }
}

// ------------------------------------------------------------------ adjustments

type AdjustmentRow = BalanceAdjustment & { createdByName: string | null }

function adjustmentRows(userId: number, account: "time" | "vacation", upto?: string): AdjustmentRow[] {
  const conds = [
    eq(balanceAdjustments.userId, userId),
    eq(balanceAdjustments.account, account),
    eq(balanceAdjustments.isDeleted, false),
  ]
  if (upto) conds.push(lte(balanceAdjustments.effectiveDate, upto))
  return db
    .select({ a: balanceAdjustments, name: users.name })
    .from(balanceAdjustments)
    .leftJoin(users, eq(users.id, balanceAdjustments.createdById))
    .where(and(...conds))
    .orderBy(asc(balanceAdjustments.effectiveDate), asc(balanceAdjustments.id))
    .all()
    .map((r) => Object.assign(r.a, { createdByName: r.name }))
}

export function serializeAdjustment(a: BalanceAdjustment & { createdByName?: string | null }): AdjustmentItem {
  return {
    id: a.id,
    account: a.account,
    amount: a.amount,
    effectiveDate: a.effectiveDate,
    kind: a.kind,
    reason: a.reason,
    createdBy: a.createdByName ?? null,
    createdAt: new Date(Date.parse(a.createdAt)).toISOString(),
  }
}

// ------------------------------------------------------------------ time balance

/** Balance through `asOf` (default: yesterday) and today's running delta. */
export function timeBalance(user: User, asOf?: string, pre: Prebuilt = {}): TimeBalance {
  const today = localToday(user.timezone)
  const until = asOf ?? addDays(today, -1)
  const upto = maxDay(until, today)
  const timeline = pre.timeline ?? personTimeline(user)
  const start = accountStart(user, timeline)
  // the current balance includes today's bookings; a balance as of a past day none dated after it
  let balance = adjustmentRows(user.id, "time", asOf ?? today).reduce((s, a) => s + a.amount, 0)
  let todayDelta = 0
  if (start <= today) {
    const ctx = loadContext(user, start, upto, { ...pre, timeline, includePending: false })
    for (const day of computeDaysFrom(ctx, { raw: true })) {
      if (day.date <= until) balance += day.deltaMin
      if (day.date === today) todayDelta = day.deltaMin
    }
  }
  return { balanceMin: r2(balance), todayDeltaMin: r2(todayDelta), asOf: until }
}

/**
 * Figures of [from, to], the balance through yesterday and the vacation account of `year`, from one load
 * (team overview and balances report need all three for every person).
 */
export function personAccounts(user: User, from: string, to: string, year: number, pre: Prebuilt = {}) {
  const timeline = pre.timeline ?? personTimeline(user)
  const start = accountStart(user, timeline)
  const today = localToday(user.timezone)
  const until = addDays(today, -1)
  const lo = minDay(minDay(start, `${Math.min(Number(start.slice(0, 4)), year)}-01-01`), from)
  const hi = maxDay(maxDay(today, `${year}-12-31`), to)
  const ctx = loadContext(user, lo, hi, { ...pre, timeline, includePending: true })
  const days = computeDaysFrom(ctx, { raw: true })
  let balance = adjustmentRows(user.id, "time", today).reduce((acc, a) => acc + a.amount, 0)
  let todayDelta = 0
  for (const day of days) {
    if (day.date < start) continue
    if (day.date <= until) balance += day.deltaMin
    if (day.date === today) todayDelta = day.deltaMin
  }
  return {
    days: days.filter((d) => d.date >= from && d.date <= to).map((d) => roundDay({ ...d })),
    balance: { balanceMin: r2(balance), todayDeltaMin: r2(todayDelta), asOf: until } satisfies TimeBalance,
    vacation: vacationFrom(user, timeline, year, ctx, days),
  }
}

/** Bank-statement view of a year: opening balance, months, adjustments, closing balance (complete days only). */
export function timeStatement(user: User, year: number): TimeStatement {
  const pre = { timeline: personTimeline(user), settings: settingsTimeline() }
  const start = accountStart(user, pre.timeline)
  const today = localToday(user.timezone)
  const yStart = `${year}-01-01`
  const yEnd = minDay(`${year}-12-31`, addDays(today, -1))
  const adjustments = adjustmentRows(user.id, "time", yEnd >= yStart ? yEnd : yStart)
  let opening = adjustments.filter((a) => a.effectiveDate < yStart).reduce((s, a) => s + a.amount, 0)
  if (start < yStart) {
    const ctx = loadContext(user, start, addDays(yStart, -1), { ...pre, includePending: false })
    for (const d of computeDaysFrom(ctx, { raw: true })) opening += d.deltaMin
  }
  const months: StatementMonth[] = []
  let running = opening
  if (yEnd >= yStart) {
    const days =
      start <= yEnd
        ? computeDaysFrom(loadContext(user, maxDay(start, yStart), yEnd, { ...pre, includePending: false }), {
            raw: true,
          })
        : []
    const byMonth = new Map<number, Day[]>()
    for (const d of days) {
      const m = Number(d.date.slice(5, 7))
      const list = byMonth.get(m)
      if (list) list.push(d)
      else byMonth.set(m, [d])
    }
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`
      const mdays = byMonth.get(m) ?? []
      const adjTotal = adjustments.filter((a) => a.effectiveDate.startsWith(key)).reduce((s, a) => s + a.amount, 0)
      // months before the account start still carry their bookings (e.g. an opening balance)
      if (!mdays.length && !adjTotal) {
        if (`${key}-01` > today) break
        continue
      }
      const s = summarize(mdays)
      running += mdays.reduce((t, d) => t + d.deltaMin, 0) + adjTotal
      months.push({ month: m, ...s, adjustmentsMin: r2(adjTotal), balanceMin: r2(running) })
    }
  }
  return {
    userId: user.id,
    year,
    openingMin: r2(opening),
    months,
    closingMin: r2(running),
    // the balance counts complete days only, but the list shows every adjustment of the year (incl. today and later)
    adjustments: adjustmentRows(user.id, "time", `${year}-12-31`)
      .filter((a) => a.effectiveDate.startsWith(`${year}-`))
      .map(serializeAdjustment),
  }
}

/**
 * The statement as a lead covering from `from` sees it: totals stay (balance, opening, closing), months that
 * ended before and the adjustments dated before are left out.
 */
export function statementFrom(s: TimeStatement, from: string | null): TimeStatement {
  if (from == null) return s
  const monthEnd = (m: number) =>
    addDays(`${s.year + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`, -1)
  return {
    ...s,
    months: s.months.filter((m) => monthEnd(m.month) >= from),
    adjustments: s.adjustments.filter((a) => a.effectiveDate >= from),
  }
}

// ------------------------------------------------------------------ vacation

/** Average scheduled days per week over [s, e] divided by 5 (1.0 for a five-day schedule). */
export function workdaysFactor(schedules: WorkSchedule[], s: string, e: string): number {
  let total = 0
  let days = 0
  let si = -1
  for (let n = epochDay(s), last = epochDay(e); n <= last; n++) {
    const d = dayOfEpoch(n)
    while (si + 1 < schedules.length && schedules[si + 1].validFrom <= d) si++
    if (si >= 0) {
      total += workdaysPerWeek(schedules[si])
      days++
    }
  }
  return days ? total / days / 5 : 1
}

/** Employed spans [start, end] within `year`, oldest first. */
export function employedSpans(timeline: Pick<PersonTimeline, "periods">, year: number): [string, string][] {
  const yStart = `${year}-01-01`
  const yEnd = `${year}-12-31`
  const out: [string, string][] = []
  for (const p of timeline.periods) {
    const s = maxDay(yStart, p.start ?? yStart)
    const e = minDay(yEnd, p.end ?? yEnd)
    if (e >= s) out.push([s, e])
  }
  return out
}

const daysInYear = (year: number) => epochDay(`${year}-12-31`) - epochDay(`${year}-01-01`) + 1
const spanDays = (s: string, e: string) => epochDay(e) - epochDay(s) + 1

/** Share of the year [0, 1] the person is employed. */
export function employmentFraction(timeline: Pick<PersonTimeline, "periods">, year: number): number {
  return employedSpans(timeline, year).reduce((acc, [s, e]) => acc + spanDays(s, e), 0) / daysInYear(year)
}

/** Half days, always rounded up. */
export function roundVacation(days: number): number {
  return Math.ceil(days * 2 - 1e-9) / 2
}

/**
 * Yearly entitlement: the vacation days per year of each employed span of that year, pro-rated for the span's
 * share of the year and by the scheduled days per week (full-time value x days / 5), rounded up to half days.
 */
export function entitlementForYear(
  timeline: PersonTimeline,
  year: number,
  overrides: Map<number, number>,
  schedules: WorkSchedule[],
): number {
  const o = overrides.get(year)
  if (o != null) return o
  let days = 0
  for (const [s, e] of employedSpans(timeline, year)) {
    // the vacation days per year may change within a span (dated terms)
    const cuts = timeline.earlier.map((t) => t.validUntil).filter((d) => d >= s && d < e)
    let from = s
    for (const until of [...cuts, e]) {
      const perYear = timeline.termsOn(from).vacationDaysPerYear
      days += (perYear * spanDays(from, until) * workdaysFactor(schedules, from, until)) / daysInYear(year)
      from = addDays(until, 1)
    }
  }
  return days > 0 ? roundVacation(days) : 0
}

export function entitlementOverrides(userId: number): Map<number, number> {
  return new Map(
    db
      .select({ year: vacationEntitlements.year, days: vacationEntitlements.days })
      .from(vacationEntitlements)
      .where(eq(vacationEntitlements.userId, userId))
      .all()
      .map((r) => [r.year, r.days]),
  )
}

function addTo(m: Map<number, number>, y: number, v: number): void {
  m.set(y, (m.get(y) ?? 0) + v)
}

function emptyVacation(userId: number, year: number): VacationAccount {
  return {
    userId,
    year,
    carriedOver: 0,
    entitlement: 0,
    adjustments: 0,
    taken: 0,
    planned: 0,
    pending: 0,
    remaining: 0,
    remainingAfterPending: 0,
    entitlementOverridden: false,
    adjustmentItems: [],
  }
}

export function vacationAccount(
  user: User,
  year: number,
  excludeAbsenceId?: number,
  pre: Prebuilt = {},
): VacationAccount {
  const timeline = pre.timeline ?? personTimeline(user)
  const startYear = Number(accountStart(user, timeline).slice(0, 4))
  const first = Math.min(startYear, year)
  const ctx = loadContext(user, `${first}-01-01`, `${year}-12-31`, {
    ...pre,
    timeline,
    includePending: true,
    entries: false,
    excludeAbsenceId,
  })
  return vacationFrom(user, timeline, year, ctx, computeDaysFrom(ctx, { raw: true }))
}

/** The vacation account of `year` from computed days reaching back to 1 January of the account start year. */
function vacationFrom(
  user: User,
  timeline: PersonTimeline,
  year: number,
  ctx: AccountContext,
  days: Day[],
): VacationAccount {
  const startYear = Number(accountStart(user, timeline).slice(0, 4))
  const today = localToday(user.timezone)
  const overrides = entitlementOverrides(user.id)
  const adjustments = adjustmentRows(user.id, "vacation")
  const used = new Map<number, number>()
  const planned = new Map<number, number>()
  const pending = new Map<number, number>()
  const vacTypes = new Set([...ctx.types.values()].filter((t) => t.deductsVacation).map((t) => t.id))
  const pendingAbs = ctx.absences.filter((a) => a.status === "pending" && vacTypes.has(a.typeId))
  for (const day of days) {
    const y = Number(day.date.slice(0, 4))
    if (day.vacationDays) addTo(day.date <= today ? used : planned, y, day.vacationDays)
    if (pendingAbs.length && day.scheduledMin > 0 && day.employed) {
      const hol = ctx.holidays.get(day.date)
      const holH = new Set(hol ? holidayHalves(hol.fraction) : [])
      for (const a of pendingAbs) addTo(pending, y, absenceHalves(a, day.date).filter((h) => !holH.has(h)).length / 2)
    }
  }
  const items = adjustments.filter((a) => a.effectiveDate.startsWith(`${year}-`)).map(serializeAdjustment)
  if (year < startYear) return { ...emptyVacation(user.id, year), adjustmentItems: items }
  // bookings dated before the first employment year (e.g. carry-over entered ahead of a hire) open it
  let carried = adjustments
    .filter((a) => Number(a.effectiveDate.slice(0, 4)) < startYear)
    .reduce((s, a) => s + a.amount, 0)
  let result = emptyVacation(user.id, year)
  for (let y = startYear; y <= year; y++) {
    const ent = entitlementForYear(timeline, y, overrides, ctx.schedules)
    const adj = adjustments.filter((a) => a.effectiveDate.startsWith(`${y}-`)).reduce((s, a) => s + a.amount, 0)
    const taken = used.get(y) ?? 0
    const plan = planned.get(y) ?? 0
    const pend = pending.get(y) ?? 0
    const remaining = carried + ent + adj - taken - plan
    result = {
      userId: user.id,
      year: y,
      carriedOver: r2(carried),
      entitlement: ent,
      adjustments: r2(adj),
      taken: r2(taken),
      planned: r2(plan),
      pending: r2(pend),
      remaining: r2(remaining),
      remainingAfterPending: r2(remaining - pend),
      entitlementOverridden: overrides.has(y),
      adjustmentItems: [],
    }
    carried = remaining
  }
  result.adjustmentItems = items
  return result
}

/** Working days an absence would cover (excludes non-workdays and holidays). */
export function countAbsenceDays(user: User, start: string, end: string, startHalf: string, endHalf: string): number {
  if (end < start) return 0
  const probe = { startDate: start, endDate: end, startHalf, endHalf }
  const schedules = schedulesOf(user.id)
  const timeline = personTimeline(user)
  const hols = holidaysFor(user, start, end, timeline.earlier)
  let total = 0
  let si = -1
  for (let n = epochDay(start), last = epochDay(end); n <= last; n++) {
    const d = dayOfEpoch(n)
    while (si + 1 < schedules.length && schedules[si + 1].validFrom <= d) si++
    if (si < 0 || !timeline.employedOn(d) || minutesOnWeekday(schedules[si], weekdayOfEpoch(n)) <= 0) continue
    const hol = hols.get(d)
    const holH = new Set(hol ? holidayHalves(hol.fraction) : [])
    total += absenceHalves(probe, d).filter((h) => !holH.has(h)).length / 2
  }
  return total
}

// ------------------------------------------------------------------ adjustments and entitlements (writes)

export interface AdjustmentInput {
  account: "time" | "vacation"
  amount: number
  effectiveDate?: string | null
  kind?: "opening" | "payout" | "correction"
  reason: string
}

function requireAdjuster(actor: Actor, userId: number): User {
  const target = requireView(actor, userId)
  if (!canAdjustBalance(actor, target)) throw new Forbidden("Not allowed to adjust balances")
  return target
}

/** Opening balance, payout or correction (minutes for time, days for vacation). Logged; reason required. */
export function createAdjustment(actor: Actor, userId: number, input: AdjustmentInput): AdjustmentItem {
  const target = requireAdjuster(actor, userId)
  if (input.account !== "time" && input.account !== "vacation") {
    throw new Validation("Invalid account", { fields: { account: "invalid" } })
  }
  const kind = input.kind ?? "correction"
  if (!["opening", "payout", "correction"].includes(kind))
    throw new Validation("Invalid kind", { fields: { kind: "invalid" } })
  const reason = (input.reason ?? "").trim()
  if (!reason) throw new Validation("A reason is required", { fields: { reason: "required" } })
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new Validation("Amount must not be zero", { fields: { amount: "zero" } })
  }
  const effectiveDate = input.effectiveDate || localToday(target.timezone)
  if (!seesDate(actor, target, effectiveDate)) throw beforeCover(actor, target)
  ensureOpenDates(target, effectiveDate)
  const row = db
    .insert(balanceAdjustments)
    .values({
      userId: target.id,
      account: input.account,
      amount: input.amount,
      effectiveDate,
      kind,
      reason: reason.slice(0, 500),
      createdById: actor.id,
    })
    .returning()
    .get()
  record({ entity: "adjustment", row, action: "create", actor, subjectUserId: target.id, before: null, reason })
  if (actor.id !== target.id) {
    notify(target.id, "balance_adjusted", {
      account: row.account,
      amount: row.amount,
      effective_date: effectiveDate,
      reason,
      actor_name: actor.user.name,
    })
  }
  return serializeAdjustment({ ...row, createdByName: actor.user.name })
}

export function deleteAdjustment(actor: Actor, adjustmentId: number, reason: string): void {
  const adj = db.select().from(balanceAdjustments).where(eq(balanceAdjustments.id, adjustmentId)).get()
  if (!adj || adj.isDeleted) throw new NotFound("Adjustment not found")
  const target = requireAdjuster(actor, adj.userId)
  requireDate(actor, target, adj.effectiveDate, "Adjustment")
  if (!reason.trim()) throw new Validation("A reason is required", { fields: { reason: "required" } })
  ensureOpenDates(target, adj.effectiveDate)
  const before = snapshot("adjustment", adj)
  const row = db
    .update(balanceAdjustments)
    .set({ isDeleted: true })
    .where(eq(balanceAdjustments.id, adj.id))
    .returning()
    .get()
  record({ entity: "adjustment", row, action: "delete", actor, subjectUserId: target.id, before, reason })
}

/** Override the vacation days of one year (`days: null` removes the override). */
export function setEntitlement(actor: Actor, userId: number, year: number, days: number | null, note = ""): void {
  const target = requireAdjuster(actor, userId)
  if (!Number.isInteger(year) || year < 1990 || year > 2100)
    throw new Validation("Invalid year", { fields: { year: "invalid" } })
  // a lead covering from a later day changes no year that began before it
  if (!seesDate(actor, target, `${year}-01-01`)) throw beforeCover(actor, target)
  const row = db
    .select()
    .from(vacationEntitlements)
    .where(and(eq(vacationEntitlements.userId, target.id), eq(vacationEntitlements.year, year)))
    .get()
  if (days == null) {
    if (row) {
      record({
        entity: "entitlement",
        row,
        action: "delete",
        actor,
        subjectUserId: target.id,
        before: snapshot("entitlement", row),
        reason: note,
      })
      db.delete(vacationEntitlements).where(eq(vacationEntitlements.id, row.id)).run()
    }
    return
  }
  if (!(days >= 0 && days <= 366)) throw new Validation("Invalid number of days", { fields: { days: "invalid" } })
  const text = note.trim().slice(0, 500)
  if (row) {
    const before = snapshot("entitlement", row)
    const updated = db
      .update(vacationEntitlements)
      .set({ days, note: text })
      .where(eq(vacationEntitlements.id, row.id))
      .returning()
      .get()
    record({
      entity: "entitlement",
      row: updated,
      action: "update",
      actor,
      subjectUserId: target.id,
      before,
      reason: note,
    })
    return
  }
  const created = db
    .insert(vacationEntitlements)
    .values({ userId: target.id, year, days, note: text })
    .returning()
    .get()
  record({
    entity: "entitlement",
    row: created,
    action: "create",
    actor,
    subjectUserId: target.id,
    before: null,
    reason: note,
  })
}
