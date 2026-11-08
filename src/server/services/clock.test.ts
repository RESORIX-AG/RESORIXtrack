import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { db, rawSqlite } from "@/server/db"
import { revisions, timeEntries } from "@/server/db/schema"
import { freeze } from "@/server/time"
import { loadActor, lockMonth, makeEntry, makeSchedule, makeUser, withSettings } from "@/test/factories"
import { clockAction, clockState, closeDueScheduled, openEntry, stopRunning, syncOffline } from "./clock"
import { listEntries } from "./entries"

const NOW = Date.parse("2026-11-05T14:00:00Z") // Thu 15:00 Zurich
const TODAY = "2026-11-05"
const t = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const setNow = (minutes: number) => freeze(t(minutes))
const stored = (minutes: number) => t(minutes).replace("Z", "000Z")

function anna() {
  const u = makeUser({ name: "Anna A" })
  makeSchedule(u.id)
  return loadActor(u.id)
}

const reasons = (userId: number) =>
  db
    .select({ reason: revisions.reason, source: revisions.source })
    .from(revisions)
    .where(eq(revisions.subjectUserId, userId))
    .all()

beforeEach(() => setNow(0))

describe("clock", () => {
  it("runs the state machine idempotently; a break is a clock-out", () => {
    const A = anna()
    expect(clockState(A.user).state).toBe("idle")
    expect(clockAction(A, "start").state).toBe("working")
    expect(clockAction(A, "start").state).toBe("working")
    setNow(60)
    expect(clockAction(A, "stop").state).toBe("idle")
    setNow(90)
    expect(clockAction(A, "start").state).toBe("working")
    setNow(120)
    const s = clockAction(A, "stop")
    expect(s).toMatchObject({ state: "idle", scheduledEnd: null, todayWorkedMin: 90, todayBreakMin: 30 })
    const entries = listEntries(A, A.id, TODAY, TODAY)
    expect(entries.map((e) => e.kind)).toEqual(["work", "work"])
    expect(entries.every((e) => e.source === "clock" && e.scheduledEndAt === null)).toBe(true)
    expect(clockAction(A, "stop").state).toBe("idle")
    expect(clockAction(A, "unschedule").state).toBe("idle")
  })

  it("a break is a clock-out followed by a clock-in", () => {
    const A = anna()
    clockAction(A, "start")
    setNow(60)
    expect(clockAction(A, "stop")).toMatchObject({ state: "idle", since: null, entry: null })
    setNow(90)
    expect(clockAction(A, "start")).toMatchObject({ state: "working", since: t(90) })
    setNow(120)
    clockAction(A, "stop")
    expect(clockState(A.user)).toMatchObject({ state: "idle", todayWorkedMin: 90, todayBreakMin: 30 })
    expect(listEntries(A, A.id, TODAY, TODAY)).toHaveLength(2)
  })

  it("accepts backdated times within limits", () => {
    const A = anna()
    expect(clockAction(A, "start", { at: t(-20) }).since).toMatch(/^2026-11-05T13:40/)
    expect(() => clockAction(A, "stop", { at: t(-3 * 24 * 60) })).toThrow(
      expect.objectContaining({ fields: { at: "too_old" } }),
    )
    expect(() => clockAction(A, "stop", { at: t(-30) })).toThrow(expect.objectContaining({ code: "clock_order" }))
  })

  it("custom times mark the entry as manual; overlaps are refused; a past stop closes at once", () => {
    const A = anna()
    expect(clockAction(A, "start", { at: t(-120), custom: true }).state).toBe("working")
    expect(openEntry(A.id)?.source).toBe("manual")
    clockAction(A, "stop")
    expect(() => clockAction(A, "start", { at: t(-60), custom: true })).toThrow(
      expect.objectContaining({ code: "overlap" }),
    )
    expect(() => clockAction(A, "start", { at: t(60), custom: true })).toThrow(
      expect.objectContaining({ fields: { at: "future" } }),
    )

    setNow(10)
    clockAction(A, "start")
    setNow(40)
    expect(clockAction(A, "stop", { at: t(30), custom: true }).state).toBe("idle")
    const last = listEntries(A, A.id, TODAY, TODAY).at(-1)!
    expect(last).toMatchObject({ source: "manual", endAt: t(30), scheduledEndAt: null })
    setNow(50)
    clockAction(A, "start")
    setNow(55)
    // within the 2 min tolerance: "now", not a plan
    expect(clockAction(A, "stop", { at: t(56) })).toMatchObject({ state: "idle", scheduledEnd: null })
    expect(listEntries(A, A.id, TODAY, TODAY).at(-1)).toMatchObject({ source: "clock", endAt: t(55) })
  })

  it("rapid clicks within one second keep entries apart and editable", () => {
    const A = anna()
    for (const [action, state] of [
      ["start", "working"],
      ["stop", "idle"],
      ["start", "working"],
      ["stop", "idle"],
    ] as const) {
      expect(clockAction(A, action).state).toBe(state)
    }
    const entries = listEntries(A, A.id, TODAY, TODAY)
    expect(entries.map((e) => e.kind)).toEqual(["work", "work"])
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1].endAt! <= entries[i].startAt).toBe(true)
    expect(entries.every((e) => e.endAt! > e.startAt)).toBe(true)
    expect(clockAction(A, "start").state).toBe("working")
  })

  it("refuses outside employment and in signed-off months", () => {
    const u = makeUser({ employmentEnd: "2026-10-31" })
    expect(() => clockAction(loadActor(u.id), "start")).toThrow(expect.objectContaining({ code: "employment_ended" }))
    const v = makeUser({ employmentStart: "2026-12-01" })
    expect(() => clockAction(loadActor(v.id), "start")).toThrow(expect.objectContaining({ code: "not_employed" }))
    const A = anna()
    lockMonth(A.id, "2026-11")
    expect(() => clockAction(A, "start")).toThrow(expect.objectContaining({ code: "period_signed_off" }))
  })

  it("one open entry per person: the database index wins a race", () => {
    const A = anna()
    makeEntry(A.id, "2026-11-05T07:00:00.000000Z", null, { source: "clock" })
    expect(() =>
      rawSqlite()
        .prepare("INSERT INTO time_entries (user_id, kind, start_at, source) VALUES (?, 'work', ?, 'clock')")
        .run(A.id, "2026-11-05T13:00:00.000000Z"),
    ).toThrow(/UNIQUE/)
    rawSqlite().prepare("UPDATE time_entries SET end_at = ? WHERE user_id = ?").run("2026-11-05T08:00:00.000000Z", A.id)
    // simulate a concurrent clock-in committing between our read ("idle") and our insert
    rawSqlite().exec(
      "CREATE TEMP TRIGGER race BEFORE INSERT ON time_entries WHEN NEW.note = 'race' BEGIN INSERT INTO time_entries (user_id, kind, start_at, source) VALUES (NEW.user_id, 'work', NEW.start_at, 'clock'); END",
    )
    expect(() => clockAction(A, "start", { note: "race" })).toThrow(
      expect.objectContaining({ code: "already_running" }),
    )
    rawSqlite().exec("DROP TRIGGER race")
  })

  it("stopRunning closes a running entry and drops its plan (deactivation)", () => {
    const A = anna()
    clockAction(A, "start", { at: t(-60) })
    clockAction(A, "stop", { at: t(120) })
    expect(stopRunning(A.user, null, "deactivated")).toMatchObject({
      endAt: "2026-11-05T14:00:00.000000Z",
      scheduledEndAt: null,
    })
    expect(clockState(A.user).state).toBe("idle")
    expect(stopRunning(A.user, null)).toBeNull()
  })

  it("stopRunning never credits more than 24 h for a forgotten clock-out", () => {
    const A = anna()
    makeEntry(A.id, stored(-3 * 24 * 60), null, { source: "clock" })
    expect(stopRunning(A.user, null, "sick")?.endAt).toBe(stored(-2 * 24 * 60))
  })

  it("counts today's breaks as the gaps between work entries", () => {
    const A = anna()
    makeEntry(A.id, stored(-300), stored(-180))
    makeEntry(A.id, stored(-120), stored(-60))
    expect(clockState(A.user)).toMatchObject({ state: "idle", todayWorkedMin: 180, todayBreakMin: 60 })
    clockAction(A, "start")
    setNow(30)
    expect(clockState(A.user)).toMatchObject({ state: "working", todayWorkedMin: 210, todayBreakMin: 120 })
  })
})

describe("clock out later", () => {
  it("a future stop schedules the clock-out and the entry closes at exactly that time", () => {
    const A = anna()
    clockAction(A, "start")
    const s = clockAction(A, "stop", { at: t(120), custom: true })
    expect(s).toMatchObject({ state: "working", scheduledEnd: t(120) })
    expect(s.entry).toMatchObject({ running: true, scheduledEndAt: t(120), source: "clock" })
    expect(reasons(A.id).at(-1)).toEqual({ reason: "clock-out scheduled for 17:00", source: "manual" })
    expect(clockAction(A, "start").state).toBe("working") // no-op while clocked in

    setNow(119)
    expect(clockState(A.user).state).toBe("working")
    // catch-up without the worker: the next clock request closes the entry
    setNow(125)
    expect(clockState(A.user)).toMatchObject({ state: "idle", scheduledEnd: null, todayWorkedMin: 120 })
    const e = listEntries(A, A.id, TODAY, TODAY).at(-1)!
    expect(e).toMatchObject({ endAt: t(120), scheduledEndAt: null, source: "manual" })
    expect(reasons(A.id).at(-1)).toEqual({ reason: "clock (scheduled clock-out)", source: "manual" })
  })

  it("refuses a plan more than 24 h after the clock-in", () => {
    const A = anna()
    clockAction(A, "start", { at: t(-60) })
    expect(() => clockAction(A, "stop", { at: t(23 * 60 + 1) })).toThrow(
      expect.objectContaining({ fields: { at: "too_late" } }),
    )
    expect(clockAction(A, "stop", { at: t(23 * 60) }).scheduledEnd).toBe(t(23 * 60))
    expect(() => clockAction(A, "stop", { at: t(-3 * 24 * 60) })).toThrow(
      expect.objectContaining({ fields: { at: "too_old" } }),
    )
  })

  it("unschedule is idempotent; 'clock out now' clears the plan", () => {
    const A = anna()
    clockAction(A, "start")
    const before = reasons(A.id).length
    expect(clockAction(A, "unschedule")).toMatchObject({ state: "working", scheduledEnd: null })
    expect(reasons(A.id)).toHaveLength(before)
    clockAction(A, "stop", { at: t(90) })
    expect(clockAction(A, "unschedule")).toMatchObject({ state: "working", scheduledEnd: null })
    expect(reasons(A.id).at(-1)).toEqual({ reason: "scheduled clock-out cancelled", source: "web" })
    expect(clockAction(A, "unschedule").scheduledEnd).toBeNull()
    expect(reasons(A.id)).toHaveLength(before + 2)

    clockAction(A, "stop", { at: t(90) })
    setNow(10)
    expect(clockAction(A, "stop")).toMatchObject({ state: "idle", scheduledEnd: null })
    expect(listEntries(A, A.id, TODAY, TODAY).at(-1)).toMatchObject({
      endAt: t(10),
      scheduledEndAt: null,
      source: "clock",
    })
  })

  it("closeDueScheduled closes due entries for everyone, one by one, and skips failures", () => {
    const A = anna()
    const B = anna()
    clockAction(A, "start")
    clockAction(A, "stop", { at: t(30) })
    clockAction(B, "start")
    clockAction(B, "stop", { at: t(45) })
    expect(closeDueScheduled()).toBe(0)
    setNow(31)
    expect(closeDueScheduled()).toBe(1)
    expect(db.select().from(timeEntries).where(eq(timeEntries.userId, A.id)).get()).toMatchObject({
      endAt: stored(30),
      scheduledEndAt: null,
      source: "manual",
    })
    expect(reasons(A.id).at(-1)).toEqual({ reason: "clock (scheduled clock-out)", source: "manual" })
    expect(openEntry(B.id)).toBeTruthy()

    // the month was signed off meanwhile: logged, skipped, left to the person
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    lockMonth(B.id, "2026-11")
    setNow(46)
    expect(closeDueScheduled()).toBe(0)
    expect(openEntry(B.id)).toMatchObject({ scheduledEndAt: stored(45) })
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

const person = () => anna()
/** Today's work entries by minute offsets from NOW, oldest first. */
const worked = (userId: number, ...spans: [number, number][]) => {
  for (const [a, b] of spans) makeEntry(userId, stored(a), stored(b), { source: "clock" })
}
const refused = (code: string, fields: Record<string, unknown>) => expect.objectContaining({ code, fields })

describe("legal minimums at clock-in", () => {
  afterEach(() => freeze(null))

  it("needs 15 min above 5.5 h, 30 min above 7 h, 60 min above 9 h", () => {
    const a = person()
    worked(a.id, [-330, 0])
    expect(clockAction(a, "start").state).toBe("working")
    const b = person()
    worked(b.id, [-331, 0])
    expect(() => clockAction(b, "start")).toThrow(
      refused("break_required", { required: 15, taken: 0, earliest: t(15) }),
    )
    const c = person()
    worked(c.id, [-440, -20])
    expect(clockAction(c, "start").state).toBe("working") // 420 min: 15 min taken is enough
    const d = person()
    worked(d.id, [-450, -29])
    expect(() => clockAction(d, "start")).toThrow(
      refused("break_required", { required: 30, taken: 29, earliest: t(1) }),
    )
    const e = person()
    worked(e.id, [-600, -60])
    expect(clockAction(e, "start").state).toBe("working") // 540 min: 30 min taken is enough
    const f = person()
    worked(f.id, [-610, -59])
    expect(() => clockAction(f, "start")).toThrow(
      refused("break_required", { required: 60, taken: 59, earliest: t(1) }),
    )
  })

  it("15 and 30 min count in one piece, 60 min may be split into pieces of 15 min", () => {
    const a = person()
    worked(a.id, [-500, -350], [-335, -200], [-185, 0]) // 470 min worked, two gaps of 15
    expect(() => clockAction(a, "start")).toThrow(
      refused("break_required", { required: 30, taken: 15, earliest: t(30) }),
    )
    setNow(29)
    expect(() => clockAction(a, "start")).toThrow(expect.objectContaining({ code: "break_required" }))
    setNow(30)
    expect(clockAction(a, "start").state).toBe("working")

    setNow(0)
    const b = person()
    worked(b.id, [-700, -500], [-470, -300], [-290, -100], [-80, 0]) // 560 min, gaps 30, 10, 20
    expect(() => clockAction(b, "start")).toThrow(
      refused("break_required", { required: 60, taken: 50, earliest: t(15) }),
    )
    setNow(10)
    expect(() => clockAction(b, "start")).toThrow(expect.objectContaining({ code: "break_required" }))
    setNow(15)
    expect(clockAction(b, "start").state).toBe("working")

    setNow(0)
    const c = person()
    worked(c.id, [-700, -500], [-470, -300], [-270, -100], [-80, -14]) // 606 min, gaps 30, 30, 20: enough
    expect(clockAction(c, "start").state).toBe("working")
  })

  it("applies to custom times and offline replays; the setting or an exemption switches it off", () => {
    const a = person()
    worked(a.id, [-400, -5])
    expect(() => clockAction(a, "start", { at: t(-2), custom: true })).toThrow(
      refused("break_required", { required: 15, taken: 3, earliest: t(10) }),
    )
    expect(syncOffline(a, [{ id: "o1", action: "start", at: t(-1) }]).results[0]).toEqual({
      id: "o1",
      status: "rejected",
      code: "break_required",
    })
    withSettings({ break_enforcement: false })
    expect(clockAction(a, "start").state).toBe("working")
    withSettings({ break_enforcement: true })

    const b = person()
    worked(b.id, [-400, -5])
    withSettings({ compliance_enabled: false })
    expect(clockAction(b, "start").state).toBe("working")
    withSettings({ compliance_enabled: true })

    const c = makeUser({ argExempt: true })
    worked(c.id, [-400, -5])
    expect(clockAction(loadActor(c.id), "start").state).toBe("working")
  })

  it("needs 11 h of rest after the previous working day", () => {
    const a = person()
    makeEntry(a.id, "2026-11-04T18:00:00.000000Z", "2026-11-04T22:00:00.000000Z")
    freeze("2026-11-05T08:59:00Z")
    expect(() => clockAction(a, "start")).toThrow(
      refused("rest_required", { requiredMin: 660, earliest: "2026-11-05T09:00:00.000Z" }),
    )
    freeze("2026-11-05T09:00:00Z")
    expect(clockAction(a, "start").state).toBe("working")

    // a gap under 3 h continues the night shift; a gap within the same day is a break
    const b = person()
    makeEntry(b.id, "2026-11-04T20:00:00.000000Z", "2026-11-05T01:00:00.000000Z")
    freeze("2026-11-05T02:00:00Z")
    expect(clockAction(b, "start").state).toBe("working")
    const c = person()
    makeEntry(c.id, "2026-11-05T06:00:00.000000Z", "2026-11-05T08:00:00.000000Z")
    freeze("2026-11-05T13:00:00Z")
    expect(clockAction(c, "start").state).toBe("working")
  })

  it("groups a night shift across midnight into one working day", () => {
    // Mon 22:00 to Tue 02:00 and 02:30 to 06:00 local: the rest runs from 06:00, not from the Tuesday entry
    const a = person()
    makeEntry(a.id, "2026-11-02T21:00:00.000000Z", "2026-11-03T01:00:00.000000Z")
    makeEntry(a.id, "2026-11-03T01:30:00.000000Z", "2026-11-03T05:00:00.000000Z")
    freeze("2026-11-03T09:00:00Z")
    expect(() => clockAction(a, "start")).toThrow(
      refused("rest_required", { requiredMin: 660, earliest: "2026-11-03T16:00:00.000Z" }),
    )
    // 18:00 to 24:00 local, back at 00:05: six hours on the same working day need a break
    const b = person()
    makeEntry(b.id, "2026-11-04T17:00:00.000000Z", "2026-11-04T23:00:00.000000Z")
    freeze("2026-11-04T23:05:00Z")
    expect(() => clockAction(b, "start")).toThrow(expect.objectContaining({ code: "break_required" }))
  })
})

describe("offline sync", () => {
  it("applies queued actions once, marks them offline and reports rejects", () => {
    const A = anna()
    const actions = [
      { id: "a1", action: "start" as const, at: t(-90) },
      { id: "a2", action: "stop" as const, at: t(-60) },
      { id: "a3", action: "start" as const, at: t(-45) },
      { id: "a4", action: "stop" as const, at: t(-10) },
    ]
    const first = syncOffline(A, actions)
    expect(first.results.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied"])
    expect(first.clock.state).toBe("idle")
    const entries = listEntries(A, A.id, TODAY, TODAY)
    expect(entries.map((e) => [e.kind, e.source, e.endAt])).toEqual([
      ["work", "offline", t(-60)],
      ["work", "offline", t(-10)],
    ])
    const again = syncOffline(A, [...actions, { id: "a5", action: "stop", at: t(-5) }])
    expect(again.results.map((r) => r.status)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate", "applied"])
    expect(listEntries(A, A.id, TODAY, TODAY)).toHaveLength(2)

    const bad = syncOffline(A, [{ id: "b1", action: "start", at: t(-30) }])
    expect(bad.results[0]).toEqual({ id: "b1", status: "rejected", code: "overlap" })
    expect(syncOffline(A, [{ id: "b1", action: "start", at: t(-1) }]).results[0].status).toBe("duplicate")
    const revs = rawSqlite().prepare("SELECT DISTINCT source FROM revisions WHERE entity = 'time_entry'").all()
    expect(revs).toEqual([{ source: "offline" }])
  })

  it("keeps ids per person", () => {
    const A = anna()
    const B = anna()
    expect(syncOffline(A, [{ id: "x", action: "start", at: t(-5) }]).results[0].status).toBe("applied")
    expect(syncOffline(B, [{ id: "x", action: "start", at: t(-5) }]).results[0].status).toBe("applied")
  })
})
