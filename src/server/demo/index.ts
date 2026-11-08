/**
 * Demo company for development (port of v1 demo.py, extended): three teams with leads and a deputy, HR, an
 * administrator, part-timers, a Swiss holiday calendar, three months of entries on projects (with breaks
 * between them), absences (approved, pending, sick), balance adjustments, a running clock and one signed-off
 * month.
 * Deterministic (seeded random), idempotent (does nothing when the demo administrator exists).
 */
import { rmSync } from "node:fs"
import { and, desc, eq } from "drizzle-orm"
import { db, rawSqlite } from "../db"
import * as s from "../db/schema"
import { isProd } from "../env"
import { hashPassword } from "../password"
import { ensureDefaultAbsenceTypes } from "../services/absence-types"
import { computeDays, summarize, timeBalance } from "../services/accounts"
import { createCalendarFromPreset } from "../services/holiday-calendars"
import { defaultPresetDays } from "../services/holiday-presets"
import { notify } from "../services/notifications"
import { type Actor, loadActor } from "../services/permissions"
import { record, snapshot } from "../services/revisions"
import { computeDigest, computeSeal, lastSeal, periodData, SEAL_VERSION } from "../services/seals"
import { updateSettings } from "../services/settings"
import { setPasswordHash } from "../services/user-auth"
import {
  addDays,
  daterange,
  dayBoundsUtc,
  fmtInstant,
  iso,
  localToday,
  localToInstant,
  monthBounds,
  nowInstant,
  utcnow,
  weekday,
  weekStart,
} from "../time"
import { emailOf, PEOPLE, PROJECTS, RUNNING, SIGNED_TEAM, TEAMS, WORK_NOTES } from "./data"

const TZ = "Europe/Zurich"
const DAY_MIN = 504 // 42 h / 5

export interface DemoAccount {
  email: string
  name: string
  label: string
  team: string
}
export interface DemoResult {
  created: boolean
  lines: string[]
  accounts: DemoAccount[]
}

/** mulberry32: small seeded PRNG so every seed produces the same company. */
function rng(initial: number) {
  let a = initial >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
  }
}
type Rng = ReturnType<typeof rng>

const plus = (at: string, minutes: number) => fmtInstant(Temporal.Instant.from(at).add({ minutes }))

export function demoAccounts(): DemoAccount[] {
  return PEOPLE.map((p) => ({ email: emailOf(p.email), name: p.name, label: p.label, team: p.team ?? "" }))
}

export async function seedDemo(opts: { password?: string } = {}): Promise<DemoResult> {
  if (isProd) throw new Error("seed-demo is for development only")
  if (
    db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, emailOf("admin")))
      .get()
  )
    return {
      created: false,
      lines: ["Demo data already present (use --reset for a fresh database)"],
      accounts: demoAccounts(),
    }
  const hash = await hashPassword(opts.password ?? "demo")
  const lines = rawSqlite().transaction(() => seed(hash))()
  return { created: true, lines, accounts: demoAccounts() }
}

function seed(hash: string): string[] {
  const r = rng(42)
  const lines: string[] = []
  const today = localToday(TZ)
  const start = `${addDays(today, -95).slice(0, 7)}-01` // demo history (= employment start)
  const year = Number(today.slice(0, 4))

  ensureDefaultAbsenceTypes()
  updateSettings({
    setup_complete: true,
    company_name: "RESORIX AG",
    default_timezone: "Europe/Zurich",
    default_locale: "de",
  })
  const cal = createCalendarFromPreset("CH-FR", {
    years: [year - 1, year, year + 1],
    presetDays: defaultPresetDays("CH-FR", year),
    makeDefault: true,
    source: "demo",
  })
  const holidays = new Set(
    db
      .select({ date: s.holidays.date })
      .from(s.holidays)
      .where(eq(s.holidays.calendarId, cal.id))
      .all()
      .map((h) => h.date),
  )
  lines.push(`Holiday calendar: ${cal.name}`)

  const teams = new Map<string, s.Team>()
  for (const [name, color] of Object.entries(TEAMS))
    teams.set(name, db.insert(s.teams).values({ name, color }).returning().get())

  const users = new Map<string, s.User>()
  for (const p of PEOPLE) {
    const u = db
      .insert(s.users)
      .values({
        email: emailOf(p.email),
        name: p.name,
        role: p.role,
        teamId: p.team ? teams.get(p.team)!.id : null,
        locale: p.locale,
        timezone: TZ,
        employmentStart: start,
        vacationDaysPerYear: 25,
        capabilities: p.caps ?? [],
        emailVerified: true,
      })
      .returning()
      .get()
    setPasswordHash(u.id, hash)
    const workdays = Math.round((5 * p.pensum) / 100) // part-timers work fewer full days (80 % = Mon-Thu)
    const m = (i: number) => (i < workdays ? DAY_MIN : 0)
    const sched = db
      .insert(s.workSchedules)
      .values({
        userId: u.id,
        validFrom: start,
        pensumPercent: p.pensum,
        minutesMon: m(0),
        minutesTue: m(1),
        minutesWed: m(2),
        minutesThu: m(3),
        minutesFri: m(4),
      })
      .returning()
      .get()
    record({ entity: "user", row: u, action: "create", actor: null, subjectUserId: u.id, before: null, source: "demo" })
    record({
      entity: "schedule",
      row: sched,
      action: "create",
      actor: null,
      subjectUserId: u.id,
      before: null,
      source: "demo",
    })
    users.set(p.email, u)
    if (p.lead && p.team) {
      const deputy = p.lead === "deputy"
      db.insert(s.teamLeads)
        .values({
          teamId: teams.get(p.team)!.id,
          userId: u.id,
          role: p.lead,
          validFrom: deputy ? today : null,
          validTo: deputy ? addDays(today, 14) : null,
        })
        .run()
    }
  }
  lines.push(`People: ${users.size} (password as given, default "demo")`)

  const projects = PROJECTS.map((p) => {
    const row = db
      .insert(s.projects)
      .values({ name: p.name, code: p.code, color: p.color, teamId: p.team ? teams.get(p.team)!.id : null })
      .returning()
      .get()
    return { id: row.id, team: p.team }
  })
  lines.push(`Projects: ${projects.length}`)

  const actor = (key: string) => loadActor(users.get(key)!.id)
  const hr = actor("nina.graf")
  const approverFor = (p: (typeof PEOPLE)[number]): Actor => {
    const lead = PEOPLE.find((x) => x.team && x.team === p.team && x.lead === "lead" && x.email !== p.email)
    return lead ? actor(lead.email) : hr
  }
  const types = new Map(
    db
      .select()
      .from(s.absenceTypes)
      .all()
      .map((t) => [t.key, t]),
  )

  let entries = 0
  for (const p of PEOPLE) {
    const u = users.get(p.email)!
    const absent = absences(r, p, u, start, today, types, approverFor(p), holidays)
    const pool = projects.filter((x) => x.team === null || x.team === p.team).map((x) => x.id)
    entries += workDays(r, u, start, today, absent, holidays, pool)
  }
  lines.push(`Time entries: ${entries}`)

  adjustments(users, hr, actor("luca.bianchi"), start)
  correction(users, actor("luca.bianchi"))
  running(users.get(RUNNING)!, today)
  const signed = signOffs(users, teams.get(SIGNED_TEAM)!, hr, actor("luca.bianchi"), today)
  lines.push(`Signed off: ${SIGNED_TEAM} ${signed}`)
  return lines
}

/** A past vacation week, a planned and a pending vacation, sometimes a sick day. Returns the approved days. */
function absences(
  r: Rng,
  p: (typeof PEOPLE)[number],
  u: s.User,
  start: string,
  today: string,
  types: Map<string, s.AbsenceType>,
  approver: Actor,
  holidays: Set<string>,
): Set<string> {
  const absent = new Set<string>()
  const self = loadActor(u.id)
  const add = (typeKey: string, from: string, to: string, status: "approved" | "pending", note = "") => {
    const decided = status === "approved" && types.get(typeKey)!.requiresApproval
    const row = db
      .insert(s.absences)
      .values({
        userId: u.id,
        typeId: types.get(typeKey)!.id,
        startDate: from,
        endDate: to,
        status,
        note,
        requestedById: u.id,
        decidedById: decided ? approver.id : null,
        decidedAt: decided ? utcnow() : null,
      })
      .returning()
      .get()
    record({ entity: "absence", row, action: "create", actor: self, subjectUserId: u.id, before: null, source: "demo" })
    if (decided)
      record({
        entity: "absence",
        row,
        action: "approve",
        actor: approver,
        subjectUserId: u.id,
        before: null,
        source: "demo",
      })
    if (status === "approved") for (const d of daterange(from, to)) absent.add(d)
  }
  const past = weekStart(addDays(start, r.int(20, 40)))
  add("vacation", past, addDays(past, 4), "approved")
  for (const [offset, status] of [
    [r.int(20, 60), "approved"],
    [r.int(70, 120), "pending"],
  ] as const) {
    const from = weekStart(addDays(today, offset))
    add("vacation", from, addDays(from, r.pick([2, 4])), status)
  }
  if (r.next() < 0.5) {
    const d = addDays(start, r.int(5, 80))
    if (weekday(d) < 5 && d < today && !absent.has(d) && !holidays.has(d))
      add("sick", d, d, "approved", p.pensum < 100 ? "Doctor" : "Flu")
  }
  return absent
}

/**
 * Clock entries for every scheduled day before today: a morning and an afternoon with a break between them,
 * each on a project. Most mornings switch project once; a few entries have no project.
 */
function workDays(
  r: Rng,
  u: s.User,
  start: string,
  today: string,
  absent: Set<string>,
  holidays: Set<string>,
  pool: number[],
): number {
  const sched = db.select().from(s.workSchedules).where(eq(s.workSchedules.userId, u.id)).get()!
  const minutes = [
    sched.minutesMon,
    sched.minutesTue,
    sched.minutesWed,
    sched.minutesThu,
    sched.minutesFri,
    sched.minutesSat,
    sched.minutesSun,
  ]
  const rows: (typeof s.timeEntries.$inferInsert)[] = []
  const add = (a: string, b: string, projectId: number | null) =>
    rows.push({
      userId: u.id,
      kind: "work",
      startAt: a,
      endAt: b,
      tz: u.timezone,
      projectId,
      note: projectId != null && r.next() < 0.6 ? r.pick(WORK_NOTES) : "",
      source: "clock",
      createdById: u.id,
    })
  for (const d of daterange(start, addDays(today, -1))) {
    const target = minutes[weekday(d)]
    if (!target || absent.has(d) || holidays.has(d)) continue
    const [h, m] = r.pick([
      [7, 30],
      [7, 45],
      [8, 0],
      [8, 0],
      [8, 15],
      [8, 30],
    ] as const)
    const morning = r.int(200, 260)
    const brk = r.pick([30, 40, 45, 60])
    const afternoon = Math.max(60, target + r.int(-30, 45) - morning)
    const s1 = localToInstant(d, `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, u.timezone)
    const e1 = plus(s1, morning)
    const s2 = plus(e1, brk)
    const roll = r.next()
    const project = () => (pool.length && roll < 0.95 ? r.pick(pool) : null)
    if (roll < 0.7) {
      const switchAt = plus(s1, r.int(60, morning - 30))
      add(s1, switchAt, project())
      add(switchAt, e1, project())
    } else add(s1, e1, project())
    add(s2, plus(s2, afternoon), project())
  }
  for (let i = 0; i < rows.length; i += 500)
    db.insert(s.timeEntries)
      .values(rows.slice(i, i + 500))
      .run()
  return rows.length
}

function adjustments(users: Map<string, s.User>, hr: Actor, lead: Actor, start: string): void {
  const items: [string, Actor, typeof s.balanceAdjustments.$inferInsert][] = [
    [
      "anna.meier",
      hr,
      { userId: 0, account: "time", amount: 240, effectiveDate: start, kind: "opening", reason: "Opening balance" },
    ],
    [
      "luca.bianchi",
      hr,
      {
        userId: 0,
        account: "vacation",
        amount: 3,
        effectiveDate: start,
        kind: "opening",
        reason: "Carry-over from last year",
      },
    ],
    [
      "lea.schneider",
      lead,
      {
        userId: 0,
        account: "time",
        amount: -90,
        effectiveDate: addDays(start, 40),
        kind: "correction",
        reason: "Doctor's appointment booked twice",
      },
    ],
    [
      "jonas.keller",
      hr,
      {
        userId: 0,
        account: "time",
        amount: -600,
        effectiveDate: addDays(start, 61),
        kind: "payout",
        reason: "Overtime paid out",
      },
    ],
  ]
  for (const [key, by, values] of items) {
    const u = users.get(key)!
    const row = db
      .insert(s.balanceAdjustments)
      .values({ ...values, userId: u.id, createdById: by.id })
      .returning()
      .get()
    record({
      entity: "adjustment",
      row,
      action: "create",
      actor: by,
      subjectUserId: u.id,
      before: null,
      reason: values.reason,
      source: "demo",
    })
    notify(u.id, "balance_adjusted", {
      account: row.account,
      amount: row.amount,
      reason: row.reason,
      actor_name: by.user.name,
    })
  }
}

/** A lead's correction, so the change log has content. */
function correction(users: Map<string, s.User>, lead: Actor): void {
  const anna = users.get("anna.meier")!
  const e = db
    .select()
    .from(s.timeEntries)
    .where(and(eq(s.timeEntries.userId, anna.id), eq(s.timeEntries.kind, "work")))
    .orderBy(desc(s.timeEntries.startAt))
    .limit(1)
    .get()
  if (!e?.endAt) return
  const before = snapshot("time_entry", e)
  const row = db
    .update(s.timeEntries)
    .set({ endAt: plus(e.endAt, 30), updatedAt: utcnow() })
    .where(eq(s.timeEntries.id, e.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row,
    action: "update",
    actor: lead,
    subjectUserId: anna.id,
    before,
    reason: "Customer call after clock-out (confirmed by phone)",
    source: "demo",
  })
  notify(anna.id, "entry_corrected", {
    entry_id: row.id,
    action: "update",
    actor_id: lead.id,
    actor_name: lead.user.name,
    reason: "Customer call after clock-out (confirmed by phone)",
    start_at: iso(row.startAt),
    end_at: iso(row.endAt),
  })
}

function running(u: s.User, today: string): void {
  const eight = localToInstant(today, "08:00", u.timezone)
  const now = nowInstant()
  const startAt =
    Temporal.Instant.compare(Temporal.Instant.from(eight).add({ hours: 1 }), now) <= 0
      ? eight
      : fmtInstant(now.subtract({ hours: 1 }))
  db.insert(s.timeEntries)
    .values({ userId: u.id, kind: "work", startAt, endAt: null, tz: u.timezone, source: "clock", createdById: u.id })
    .run()
}

/** Previous month of every member of the team, sealed (v2) and chained like the sign-off service does. */
function signOffs(users: Map<string, s.User>, team: s.Team, hr: Actor, lead: Actor, today: string): string {
  const prev = addDays(`${today.slice(0, 7)}-01`, -1)
  const month = prev.slice(0, 7)
  const [startDate, endDate] = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)))
  for (const u of [...users.values()].filter((x) => x.teamId === team.id)) {
    const signer = u.id === lead.id ? hr : lead
    const startUtc = dayBoundsUtc(startDate, u.timezone)[0]
    const endUtc = dayBoundsUtc(endDate, u.timezone)[1]
    const sum = summarize(computeDays(u, startDate, endDate, { includePending: false }))
    const snap = JSON.stringify({
      scheduled_min: sum.scheduledMin,
      target_min: sum.targetMin,
      target_total_min: sum.targetTotalMin,
      worked_min: sum.workedMin,
      credit_min: sum.creditMin,
      delta_min: sum.deltaMin,
      vacation_days: sum.vacationDays,
      workdays: sum.workdays,
      balance_end_min: timeBalance(u, endDate).balanceMin,
      timezone: u.timezone,
      user_name: u.name,
      signed_by_name: signer.user.name,
    })
    const base = {
      userId: u.id,
      month,
      periodStartDate: startDate,
      periodEndDate: endDate,
      periodStartUtc: startUtc,
      periodEndUtc: endUtc,
      signedById: signer.id,
      signedAt: `${utcnow().slice(0, 19)}.000000Z`,
      note: "",
      snapshot: snap,
      digest: computeDigest(periodData(u.id, startDate, endDate, startUtc, endUtc)),
      prevSeal: lastSeal(u.id),
      sealVersion: SEAL_VERSION,
    }
    const row = db
      .insert(s.monthSignoffs)
      .values({ ...base, seal: computeSeal(base) })
      .returning()
      .get()
    db.insert(s.revisions)
      .values({
        entity: "signoff",
        entityId: row.id,
        subjectUserId: u.id,
        actorId: signer.id,
        action: "signoff",
        after: { month, digest: row.digest, seal: row.seal },
        source: "demo",
      })
      .run()
    notify(u.id, "month_signed_off", { month, actor_name: signer.user.name, signoff_id: row.id })
  }
  return month
}

/** Delete the development database (and attachments) so the next open starts fresh. Never in production. */
export function resetDevDatabase(file: string, attachmentsDir: string): void {
  if (isProd) throw new Error("seed-demo is for development only")
  if (file === ":memory:") return
  for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true })
  rmSync(attachmentsDir, { recursive: true, force: true })
}

export function formatAccounts(accounts: DemoAccount[], password: string): string {
  const rows = [["email", "name", "team", "role"], ...accounts.map((a) => [a.email, a.name, a.team || "-", a.label])]
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd()
  return [
    line(rows[0]),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.slice(1).map(line),
    "",
    `password for all: ${password}`,
  ].join("\n")
}
