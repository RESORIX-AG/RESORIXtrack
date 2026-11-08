import { beforeEach, describe, expect, it } from "vitest"
import type { User } from "@/server/db/schema"
import { freeze, localToInstant } from "@/server/time"
import {
  loadActor,
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
  type DayFigures,
  dayFindings,
  evaluatePeriod,
  type Finding,
  findingsFor,
  hasVacationBlock,
  overtimeFromDays,
  overtimeYear,
  overtimeYearFinding,
  periodFindings,
  type RuleKey,
  teamComplianceSummary,
  yearFindings,
} from "./compliance"

const TZ = "Europe/Zurich"
const RULES = { enabled: true, nightPermitted: false, sundayPermitted: false }
const FULL = { recordingMode: "full" as const, legalWeeklyMaxHours: 45, argExempt: false }

beforeEach(() => freeze("2026-11-20T12:00:00Z"))

function person(over: Partial<User> = {}) {
  const u = makeUser({ employmentStart: "2025-01-01", ...over })
  makeSchedule(u.id, { validFrom: "2025-01-01" })
  return u
}
const work = (u: User, day: string, from: string, to: string, kind: "work" | "break" = "work") => {
  const s = localToInstant(day, from, TZ)
  let e = localToInstant(day, to, TZ)
  if (e <= s) e = localToInstant(Temporal.PlainDate.from(day).add({ days: 1 }).toString(), to, TZ)
  makeEntry(u.id, s, e, { kind })
}
const of = (findings: Finding[], rule: RuleKey) => findings.filter((f) => f.rule === rule)
const rest = (u: User, from: string, to: string) => of(periodFindings(u, from, to), "compensatory_rest")

describe("day rules", () => {
  it("break_min", () => {
    const u = person()
    work(u, "2026-11-02", "08:00", "16:00")
    work(u, "2026-11-03", "08:00", "12:00")
    work(u, "2026-11-03", "12:30", "16:30")
    const f = of(periodFindings(u, "2026-11-02", "2026-11-03"), "break_min")
    expect(f).toEqual([
      { rule: "break_min", severity: "violation", date: "2026-11-02", value: 0, limit: 30, ref: "ArG Art. 15" },
    ])
    const day: DayFigures = {
      date: "2026-11-02",
      weekday: 0,
      workedMin: 340,
      breakMin: 15,
      isWorkday: true,
      isFuture: false,
      running: false,
    }
    expect(dayFindings(day, RULES, FULL)).toEqual([])
    expect(dayFindings({ ...day, breakMin: 10 }, RULES, FULL)).toHaveLength(1)
    expect(dayFindings({ ...day, breakMin: 10 }, RULES, { ...FULL, argExempt: true })).toEqual([])
    expect(dayFindings({ ...day, breakMin: 10 }, { ...RULES, enabled: false }, FULL)).toEqual([])
    expect(dayFindings({ ...day, breakMin: 10, running: true }, RULES, FULL)).toEqual([])
  })

  it("break_min: a night shift across midnight is one working day", () => {
    const u = person()
    work(u, "2026-11-02", "20:00", "04:00") // 8 h without a break, 4 h on each calendar day
    work(u, "2026-11-04", "18:00", "06:00") // 12 h without a break
    const f = of(periodFindings(u, "2026-11-02", "2026-11-05"), "break_min")
    expect(f.map((x) => [x.date, x.value, x.limit])).toEqual([
      ["2026-11-02", 0, 30],
      ["2026-11-04", 0, 60],
    ])
  })

  it("break_min counts 15 and 30 min in one piece, 60 min in pieces of 15; break_stretch after 5.5 h", () => {
    const u = person()
    // 8 h with three 10-minute gaps: no 30 min piece
    work(u, "2026-11-02", "08:00", "10:00")
    work(u, "2026-11-02", "10:10", "12:10")
    work(u, "2026-11-02", "12:20", "14:20")
    work(u, "2026-11-02", "14:30", "16:30")
    // 9.5 h with breaks of 30 and 20 min plus 10 min: 50 min in pieces of 15, not enough
    work(u, "2026-11-03", "07:00", "10:00")
    work(u, "2026-11-03", "10:30", "13:30")
    work(u, "2026-11-03", "13:50", "15:20")
    work(u, "2026-11-03", "15:30", "17:30")
    // 8 h with a 30 min break after 1 h, then 7 h in one go
    work(u, "2026-11-04", "07:00", "08:00")
    work(u, "2026-11-04", "08:30", "15:30")
    const f = periodFindings(u, "2026-11-02", "2026-11-04").filter((x) => x.rule.startsWith("break"))
    expect(f.map((x) => [x.date, x.rule, x.value, x.limit])).toEqual([
      ["2026-11-02", "break_min", 10, 30],
      ["2026-11-03", "break_min", 50, 60],
      ["2026-11-04", "break_stretch", 420, 330],
    ])
  })

  it("daily_rest: below 8 h violation, once a week 8-11 h warning", () => {
    const u = person()
    work(u, "2026-11-02", "13:00", "22:00")
    work(u, "2026-11-03", "05:00", "12:00") // 7 h rest
    work(u, "2026-11-03", "20:00", "22:00") // same working day (gap >= 3 h, starts on the 3rd)
    work(u, "2026-11-04", "07:00", "12:00") // 9 h rest: first reduction this week
    work(u, "2026-11-04", "14:00", "22:00")
    work(u, "2026-11-05", "07:00", "11:00") // 9 h rest again: violation
    work(u, "2026-11-06", "08:00", "12:00") // 21 h rest
    const f = of(periodFindings(u, "2026-11-02", "2026-11-06"), "daily_rest")
    expect(f.map((x) => [x.date, x.severity, x.value])).toEqual([
      ["2026-11-03", "violation", 420],
      ["2026-11-04", "warning", 540],
      ["2026-11-05", "violation", 540],
    ])
  })

  it("day_span", () => {
    const u = person()
    work(u, "2026-11-02", "06:00", "10:00")
    work(u, "2026-11-02", "17:00", "21:00")
    work(u, "2026-11-04", "07:00", "11:00")
    work(u, "2026-11-04", "14:00", "18:00")
    const f = of(periodFindings(u, "2026-11-02", "2026-11-04"), "day_span")
    expect(f.map((x) => [x.date, x.value])).toEqual([["2026-11-02", 900]])
  })

  it("night_work: warning, info with a permit", () => {
    const u = person()
    work(u, "2026-11-02", "22:00", "23:30")
    work(u, "2026-11-03", "08:00", "12:00")
    work(u, "2026-11-04", "05:00", "08:00")
    const f = of(periodFindings(u, "2026-11-02", "2026-11-04"), "night_work")
    expect(f.map((x) => [x.date, x.severity, x.value])).toEqual([
      ["2026-11-02", "warning", 30],
      ["2026-11-04", "warning", 60],
    ])
    withSettings({ night_work_permitted: true })
    expect(of(periodFindings(u, "2026-11-02", "2026-11-02"), "night_work")[0].severity).toBe("info")
  })

  it("sunday_work: Saturday 23:00 to Sunday 23:00 and 1 August", () => {
    const u = person()
    work(u, "2026-11-07", "10:00", "12:00") // Saturday daytime: no finding
    work(u, "2026-11-07", "23:30", "23:59") // Saturday night counts for Sunday
    work(u, "2026-11-08", "10:00", "11:00")
    work(u, "2026-08-01", "09:00", "10:00") // Saturday, national holiday
    const f = of(periodFindings(u, "2026-07-27", "2026-11-08"), "sunday_work")
    expect(f.map((x) => [x.date, x.value])).toEqual([
      ["2026-08-01", 60],
      ["2026-11-08", 89],
    ])
    withSettings({ sunday_work_permitted: true })
    expect(of(periodFindings(u, "2026-11-08", "2026-11-08"), "sunday_work")[0].severity).toBe("info")
  })

  it("sunday_work: Saturday night alone counts, without work on Sunday", () => {
    const u = person()
    work(u, "2026-11-14", "18:00", "23:59")
    const f = of(periodFindings(u, "2026-11-14", "2026-11-15"), "sunday_work")
    expect(f.map((x) => [x.date, x.value])).toEqual([["2026-11-15", 59]])
  })

  it("compensatory_rest: > 5 h needs a rest day on a working day in the week before or after", () => {
    const weekdays = (u: User, from: string, to: string, skip: string[] = []) => {
      for (let d = from; d <= to; d = Temporal.PlainDate.from(d).add({ days: 1 }).toString()) {
        const wd = Temporal.PlainDate.from(d).dayOfWeek
        if (wd <= 5 && !skip.includes(d)) work(u, d, "08:00", "12:00")
      }
    }
    // no free working day from 1 to 15 November: violation, with the article
    const busy = person()
    weekdays(busy, "2026-11-02", "2026-11-13")
    work(busy, "2026-11-08", "08:00", "14:30")
    expect(rest(busy, "2026-11-08", "2026-11-08")).toEqual([
      {
        rule: "compensatory_rest",
        severity: "violation",
        date: "2026-11-08",
        value: 390,
        limit: 300,
        ref: "ArG Art. 20",
      },
    ])
    // a free Wednesday in the following week is the rest day
    const rested = person()
    weekdays(rested, "2026-11-02", "2026-11-13", ["2026-11-11"])
    work(rested, "2026-11-08", "08:00", "14:30")
    expect(rest(rested, "2026-11-08", "2026-11-08")).toEqual([])
    // vacation is no rest day
    const away = person()
    weekdays(away, "2026-11-02", "2026-11-13", ["2026-11-11"])
    work(away, "2026-11-08", "08:00", "14:30")
    makeAbsenceRow(away.id, makeAbsenceType({ key: "vacation" }).id, "2026-11-11", "2026-11-11")
    expect(rest(away, "2026-11-08", "2026-11-08").map((f) => f.severity)).toEqual(["violation"])
    // up to 5 h: a reminder of equal time off within 4 weeks
    const short = person()
    work(short, "2026-11-08", "08:00", "12:00")
    expect(rest(short, "2026-11-08", "2026-11-08")).toMatchObject([{ severity: "info", value: 240, limit: 300 }])
    // the following week is not over yet: still open
    const recent = person()
    weekdays(recent, "2026-11-09", "2026-11-20")
    work(recent, "2026-11-15", "08:00", "14:30")
    expect(rest(recent, "2026-11-15", "2026-11-15").map((f) => f.severity)).toEqual(["info"])
  })

  it("compensatory_rest and sunday_work also on full-day public holidays", () => {
    makeCalendar({}, [{ date: "2026-11-11", name: "Holiday" }])
    const u = person()
    work(u, "2026-11-11", "08:00", "14:30")
    for (const d of ["02", "03", "04", "05", "06", "09", "10", "12", "13", "16", "17", "18"])
      work(u, `2026-11-${d}`, "08:00", "12:00")
    const f = periodFindings(u, "2026-11-11", "2026-11-11")
    expect(of(f, "sunday_work").map((x) => x.value)).toEqual([390])
    expect(of(f, "compensatory_rest").map((x) => x.severity)).toEqual(["violation"])
    expect(periodFindings(person({ argExempt: true }), "2026-11-11", "2026-11-11")).toEqual([])
  })

  it("consecutive_days", () => {
    const u = person()
    for (const d of ["02", "03", "04", "05", "06", "07"]) work(u, `2026-11-${d}`, "08:00", "10:00")
    expect(of(periodFindings(u, "2026-11-02", "2026-11-08"), "consecutive_days")).toEqual([])
    work(u, "2026-11-08", "08:00", "10:00")
    expect(of(periodFindings(u, "2026-11-02", "2026-11-08"), "consecutive_days").map((x) => [x.date, x.value])).toEqual(
      [["2026-11-08", 7]],
    )
  })
})

const week = (minutes: number[], start = "2026-11-02"): DayFigures[] =>
  minutes.map((m, i) => ({
    date: Temporal.PlainDate.from(start).add({ days: i }).toString(),
    weekday: i,
    workedMin: m,
    breakMin: 60,
    isWorkday: i < 5,
    isFuture: false,
    running: false,
  }))

const evalWeek = (days: DayFigures[], hours = 45) =>
  evaluatePeriod({
    start: days[0].date,
    end: days.at(-1)!.date,
    tz: TZ,
    days,
    entries: [],
    person: { recordingMode: "full", legalWeeklyMaxHours: hours, argExempt: false },
    rules: RULES,
  })

const vacationDay = (date: string, vacationDays: number, scheduledMin = 504) => ({
  date,
  vacationDays,
  scheduledMin,
  holiday: null,
})

describe("week and year rules", () => {
  it("weekly_max", () => {
    const over = week([600, 600, 600, 600, 420, 0, 0]) // 47 h
    expect(of(evalWeek(over), "weekly_max")).toEqual([
      { rule: "weekly_max", severity: "warning", week: "2026-11-02", value: 2820, limit: 2700, ref: "ArG Art. 9" },
    ])
    expect(of(evalWeek(over, 50), "weekly_max")).toEqual([])
    expect(of(evalWeek(week([528, 528, 528, 528, 528, 0, 0])), "weekly_max")).toEqual([])
  })

  it("overtime_daily: more than 2 h Überzeit on one day, except work-free weekdays", () => {
    const days = week([630, 630, 630, 630, 360, 0, 0]) // 42 h by Thursday, Friday reaches 48 h
    expect(overtimeFromDays(days, 45).get("2026-11-06")).toBe(180)
    expect(of(evalWeek(days), "overtime_daily").map((x) => [x.date, x.value])).toEqual([["2026-11-06", 180]])
    expect(of(evalWeek(week([630, 630, 630, 630, 240, 0, 0])), "overtime_daily")).toEqual([])
    const freeFriday = week([630, 630, 630, 630, 360, 0, 0])
    freeFriday[4].isWorkday = false
    expect(of(evalWeek(freeFriday), "overtime_daily")).toEqual([])
  })

  it("overtime_yearly: 170 h (45-h staff) / 140 h (50-h staff), warning from 80 %", () => {
    expect(
      overtimeYearFinding({ year: 2026, overtimeMin: 171 * 60, limitMin: 170 * 60, warnAtMin: 136 * 60 })?.severity,
    ).toBe("violation")
    expect(
      overtimeYearFinding({ year: 2026, overtimeMin: 140 * 60, limitMin: 170 * 60, warnAtMin: 136 * 60 })?.severity,
    ).toBe("warning")
    expect(
      overtimeYearFinding({ year: 2026, overtimeMin: 100 * 60, limitMin: 170 * 60, warnAtMin: 136 * 60 }),
    ).toBeNull()
    const u = person({ legalWeeklyMaxHours: 50 })
    for (const d of ["02", "03", "04", "05", "06"]) {
      work(u, `2026-11-${d}`, "06:00", "12:00")
      work(u, `2026-11-${d}`, "13:00", "19:00")
    }
    const o = overtimeYear(u, 2026)
    expect(o).toMatchObject({
      limitMin: 140 * 60,
      overtimeMin: 600,
      weeks: [{ week: "2026-11-02", workedMin: 3600, overtimeMin: 600 }],
    })
  })

  it("vacation_minimum: 4 weeks, 5 weeks up to the year of the 20th birthday, by days per week", () => {
    const ok = person({ vacationDaysPerYear: 20 })
    expect(of(yearFindings(ok, 2026), "vacation_minimum")).toEqual([])
    const low = person({ vacationDaysPerYear: 18 })
    expect(of(yearFindings(low, 2026), "vacation_minimum")).toEqual([
      { rule: "vacation_minimum", severity: "violation", year: 2026, value: 18, limit: 20, ref: "OR 329a" },
    ])
    const young = person({ vacationDaysPerYear: 20, birthDate: "2007-05-01" })
    expect(of(yearFindings(young, 2026), "vacation_minimum")[0]?.limit).toBe(25)
    // the full-time value, pro-rated by working days: 20 x 3/5 = 12 of a minimum of 12
    const part = makeUser({ employmentStart: "2025-01-01", vacationDaysPerYear: 20 })
    makeSchedule(part.id, { validFrom: "2025-01-01", minutesThu: 0, minutesFri: 0 })
    expect(of(yearFindings(part, 2026), "vacation_minimum")).toEqual([])
  })

  it("vacation_block: info after 1 October without two consecutive weeks off", () => {
    const vac = makeAbsenceType({ key: "vacation", category: "vacation", deductsVacation: true })
    const none = person()
    makeAbsenceRow(none.id, vac.id, "2026-07-06", "2026-07-10")
    expect(of(yearFindings(none, 2026), "vacation_block")).toEqual([
      { rule: "vacation_block", severity: "info", year: 2026, value: 0, limit: 14, ref: "OR 329c" },
    ])
    const block = person()
    makeAbsenceRow(block.id, vac.id, "2026-07-06", "2026-07-17")
    expect(of(yearFindings(block, 2026), "vacation_block")).toEqual([])
    freeze("2026-09-30T10:00:00Z")
    expect(of(yearFindings(none, 2026), "vacation_block")).toEqual([])
    expect(
      hasVacationBlock([
        vacationDay("a", 0, 0),
        ...Array.from({ length: 12 }, () => vacationDay("v", 1)),
        vacationDay("b", 0, 0),
      ]),
    ).toBe(true)
    expect(hasVacationBlock(Array.from({ length: 13 }, () => vacationDay("v", 1)))).toBe(false)
  })
})

describe("modes and access", () => {
  it("waived and disabled run nothing; simplified skips time-of-day rules", () => {
    const u = person({ recordingMode: "waived" })
    work(u, "2026-11-02", "06:00", "23:30")
    expect(periodFindings(u, "2026-11-02", "2026-11-02")).toEqual([])
    const s = person({ recordingMode: "simplified" })
    work(s, "2026-11-02", "06:00", "10:00")
    work(s, "2026-11-02", "17:00", "23:30")
    const rules = periodFindings(s, "2026-11-02", "2026-11-02").map((f) => f.rule)
    expect(rules).toContain("night_work")
    expect(rules).not.toContain("day_span")
    expect(rules).not.toContain("break_min")
    withSettings({ compliance_enabled: false })
    expect(periodFindings(s, "2026-11-02", "2026-11-02")).toEqual([])
    expect(yearFindings(s, 2026)).toEqual([])
  })

  it("senior executives (ArG Art. 3 lit. d) get no findings anywhere", () => {
    const team = makeTeam()
    const lead = makeUser()
    makeLead(team.id, lead.id)
    const exec = person({ argExempt: true, teamId: team.id, vacationDaysPerYear: 10 })
    work(exec, "2026-11-02", "06:00", "23:30")
    expect(periodFindings(exec, "2026-11-02", "2026-11-02")).toEqual([])
    expect(yearFindings(exec, 2026)).toEqual([])
    expect(teamComplianceSummary(loadActor(lead.id), "2026-11-02", "2026-11-02")[0].counts).toEqual({
      violation: 0,
      warning: 0,
      info: 0,
    })
    const regular = person({ vacationDaysPerYear: 10 })
    work(regular, "2026-11-02", "06:00", "23:30")
    expect(periodFindings(regular, "2026-11-02", "2026-11-02").length).toBeGreaterThan(0)
  })

  it("the break check cannot be turned off: the retired setting is ignored", () => {
    withSettings({ break_rules_enabled: false })
    const u = person()
    work(u, "2026-11-02", "08:00", "16:00")
    expect(of(periodFindings(u, "2026-11-02", "2026-11-02"), "break_min")).toHaveLength(1)
  })

  it("team summary for managers only, findings only for visible people", () => {
    const team = makeTeam()
    const lead = makeUser()
    makeLead(team.id, lead.id)
    const m = person({ teamId: team.id, name: "Mia" })
    const other = person({ name: "Otto" })
    work(m, "2026-11-02", "08:00", "17:00")
    const rows = teamComplianceSummary(loadActor(lead.id), "2026-11-02", "2026-11-02")
    expect(rows).toEqual([
      {
        userId: m.id,
        name: "Mia",
        teamId: team.id,
        counts: { violation: 1, warning: 0, info: 0 },
        rules: { break_min: 1 },
      },
    ])
    expect(teamComplianceSummary(loadActor(m.id), "2026-11-02", "2026-11-02")).toEqual([])
    expect(findingsFor(loadActor(m.id), m.id, "2026-11-02", "2026-11-02").counts.violation).toBe(1)
    expect(() => findingsFor(loadActor(m.id), other.id, "2026-11-02", "2026-11-02")).toThrow(
      expect.objectContaining({ code: "not_found" }),
    )
    const hr = makeUser({ capabilities: ["hr"] })
    expect(teamComplianceSummary(loadActor(hr.id), "2026-11-02", "2026-11-02").map((r) => r.name)).toEqual(
      expect.arrayContaining(["Mia", "Otto"]),
    )
  })
})
