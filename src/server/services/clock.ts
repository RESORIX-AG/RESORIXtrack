/**
 * The clock (idle <-> working), port of v1 services/entries.py. A break is simply a clock-out: the gap between
 * two work entries. "Clock out later" schedules the clock-out: the entry stays open and is closed at exactly
 * that time by `closeDueScheduled` (worker job every minute, and first thing in every clock request).
 *
 * - Actions are idempotent: repeating the current state's action is a no-op (double clicks, retries).
 * - `at` backdates an action (offline sync, or a time chosen by hand with `custom`, which marks the entry
 *   as manual): at most 48 h back, never before the running entry started. A stop more than 2 min in the
 *   future schedules the clock-out instead (at most 24 h after the clock-in).
 * - Offline sync replays queued actions with client action ids; ids already processed are skipped.
 * - The partial unique index `uq_time_entries_open` guarantees one running entry per person even under
 *   concurrent requests; a lost race answers `already_running`.
 * - Clock-ins respect the legal minimum break and daily rest when the setting is on (clock-guards.ts).
 * - `switch` changes the project while working: the running entry ends and the next one starts at the same
 *   second, so no break appears and the legal-rest check does not apply. Within the first minute of an entry
 *   it just relabels that entry.
 */
import { and, eq, gt, isNotNull, isNull, like, lt, lte, max } from "drizzle-orm"
import { db, rawSqlite } from "../db"
import { appState, type TimeEntry, timeEntries, type User } from "../db/schema"
import { AppError, Conflict, Validation } from "../errors"
import { dayBoundsUtc, instantOfMs, iso, localClock, localDateOf, localToday, nowInstant, utcnow } from "../time"
import { CLOCK_ACTIONS, type OFFLINE_ACTIONS } from "./clock.schemas"
import { ensureLegalRest } from "./clock-guards"
import {
  type EntrySource,
  type EntryView,
  entriesBetween,
  MAX_ENTRY_MS,
  ms,
  parseInstantInput,
  type RevisionSource,
  serializeEntry,
} from "./entries"
import { ensureOpenInstants } from "./locks"
import { type Actor, loadActor } from "./permissions"
import { type ProjectFields, resolveProjectFields } from "./project-time"
import { record, snapshot } from "./revisions"

export { CLOCK_ACTIONS, OFFLINE_ACTIONS } from "./clock.schemas"

export type ClockAction = (typeof CLOCK_ACTIONS)[number]
export type OfflineClockAction = (typeof OFFLINE_ACTIONS)[number]
export type ClockStateName = "idle" | "working"

const FUTURE_TOLERANCE_MS = 2 * 60_000
const BACKDATE_NOTE_AFTER_MS = 15 * 60_000
const CLOCK_BACKDATE_LIMIT_MS = 48 * 3600_000
const RAPID_MS = 5000
const OFFLINE_KEEP_DAYS = 30
export const SCHEDULED_CLOCK_OUT_REASON = "clock (scheduled clock-out)"

export interface ClockState {
  state: ClockStateName
  entry: EntryView | null
  since: string | null
  /** When the running entry closes automatically ("clock out later"), ISO. */
  scheduledEnd: string | null
  todayWorkedMin: number
  /** Gaps between today's work entries (first start to last end minus worked), as the time account counts. */
  todayBreakMin: number
  serverTime: string
}

export function openEntry(userId: number): TimeEntry | undefined {
  return db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endAt), eq(timeEntries.isDeleted, false)))
    .get()
}

export function clockState(user: User): ClockState {
  closeDueScheduled(user.id)
  const e = openEntry(user.id)
  const [s, en] = dayBoundsUtc(localToday(user.timezone), user.timezone)
  const now = nowInstant().epochMilliseconds
  let worked = 0
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const t of entriesBetween(user.id, s, en)) {
    const a = Math.max(ms(t.startAt), ms(s))
    const b = Math.min(t.endAt ? ms(t.endAt) : now, ms(en))
    if (b <= a) continue
    worked += (b - a) / 60000
    first = Math.min(first, a)
    last = Math.max(last, b)
  }
  const breaks = worked > 0 ? Math.max(0, (last - first) / 60000 - worked) : 0
  return {
    state: e ? "working" : "idle",
    entry: e ? serializeEntry(e) : null,
    since: e ? iso(e.startAt) : null,
    scheduledEnd: e ? iso(e.scheduledEndAt) : null,
    todayWorkedMin: Math.round(worked * 100) / 100,
    todayBreakMin: Math.round(breaks * 100) / 100,
    serverTime: iso(utcnow()),
  }
}

function ensureEmployed(user: User, at: string): void {
  const day = localDateOf(at, user.timezone)
  if (user.employmentEnd && day > user.employmentEnd) {
    throw new Conflict("Employment has ended; the clock can no longer be used", { code: "employment_ended" })
  }
  if (user.employmentStart && day < user.employmentStart) {
    throw new Conflict("Employment has not started yet", { code: "not_employed" })
  }
}

/** Effective time (epoch ms, whole seconds) of an action. */
function clockTime(at: string | null, current: TimeEntry | undefined): number {
  const now = nowInstant().epochMilliseconds
  let t = now
  if (at != null) {
    const a = ms(at)
    if (a > now + FUTURE_TOLERANCE_MS) throw new Validation("Clock time is in the future", { fields: { at: "future" } })
    if (a < now - CLOCK_BACKDATE_LIMIT_MS) {
      throw new Validation("Clock time is too far in the past; add an entry instead", { fields: { at: "too_old" } })
    }
    t = Math.min(a, now)
  }
  t = Math.floor(t / 1000) * 1000
  if (current && t < ms(current.startAt)) {
    // rapid clicks: entries are kept >= 1 s apart
    if (at == null || ms(current.startAt) - t <= RAPID_MS) return ms(current.startAt)
    throw new Conflict("Clock time is before the current entry started", { code: "clock_order" })
  }
  return t
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: time_entries/.test(err.message)
}

interface StartOptions {
  note?: string
  project?: ProjectFields
  /** Continues a running entry (switch): no legal-rest check, keeps a scheduled clock-out. */
  continues?: TimeEntry
}

/** A clock-in never fails over its project (e.g. deactivated while a device was offline): it starts without. */
function projectOrNone(actor: Actor, user: User, input: ProjectFields | undefined) {
  try {
    return resolveProjectFields(actor, user, input ?? {}, null)
  } catch (err) {
    if (!(err instanceof AppError)) throw err
    return { projectId: null }
  }
}

function startNew(actor: Actor, t0: number, source: RevisionSource, opts: StartOptions = {}): TimeEntry {
  const user = actor.user
  let t = t0
  ensureOpenInstants(user, instantOfMs(t))
  ensureEmployed(user, instantOfMs(t))
  const at = instantOfMs(t)
  const later = db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, user.id),
        eq(timeEntries.isDeleted, false),
        gt(timeEntries.startAt, instantOfMs(t - MAX_ENTRY_MS - 3600_000)),
        gt(timeEntries.endAt, at),
      ),
    )
    .limit(1)
    .get()
  if (later) {
    const latestEnd = db
      .select({ v: max(timeEntries.endAt) })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, user.id), eq(timeEntries.isDeleted, false)))
      .get()?.v
    if (latestEnd && ms(latestEnd) - t <= RAPID_MS && ms(later.startAt) <= t) t = ms(latestEnd)
    else
      throw new Conflict("Clock time overlaps an existing entry", {
        code: "overlap",
        fields: { overlaps: serializeEntry(later) },
      })
  }
  if (!opts.continues) ensureLegalRest(user, t)
  // a switch passes the project it already resolved
  const project = opts.continues
    ? { projectId: opts.project?.projectId ?? null }
    : projectOrNone(actor, user, opts.project)
  const scheduled = opts.continues?.scheduledEndAt
  const entrySource: EntrySource = source === "web" ? "clock" : source
  const now = utcnow()
  let e: TimeEntry
  try {
    e = db
      .insert(timeEntries)
      .values({
        userId: user.id,
        kind: "work",
        startAt: instantOfMs(t),
        endAt: null,
        scheduledEndAt: scheduled && ms(scheduled) > t ? scheduled : null,
        tz: user.timezone,
        note: (opts.note ?? "").trim().slice(0, 500),
        ...project,
        source: entrySource,
        createdById: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
  } catch (err) {
    if (isUniqueViolation(err)) throw new Conflict("The clock is already running", { code: "already_running" })
    throw err
  }
  const backdated = nowInstant().epochMilliseconds - t > BACKDATE_NOTE_AFTER_MS
  record({
    entity: "time_entry",
    row: e,
    action: "create",
    actor,
    subjectUserId: user.id,
    before: null,
    source,
    reason: backdated ? "offline sync: clocked with an earlier time" : "",
  })
  return e
}

/** Close the open entry at `t` (clears any scheduled clock-out); returns the effective end. */
function close(actor: Actor, e: TimeEntry, t0: number, source: RevisionSource, reason?: string): number {
  let t = t0
  ensureOpenInstants(actor.user, instantOfMs(t))
  const backdated = nowInstant().epochMilliseconds - t > BACKDATE_NOTE_AFTER_MS
  const before = snapshot("time_entry", e)
  const start = ms(e.startAt)
  if (t <= start) t = start + 1000 // start and stop within the same second
  if (t - start > MAX_ENTRY_MS) t = start + MAX_ENTRY_MS
  const updated = db
    .update(timeEntries)
    .set({
      endAt: instantOfMs(t),
      scheduledEndAt: null,
      updatedAt: utcnow(),
      // an end chosen by hand ("clock out with a custom time") is shown as manual, not as a punch
      ...(source === "manual" ? { source: "manual" as const } : {}),
    })
    .where(eq(timeEntries.id, e.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: updated,
    action: "update",
    actor,
    subjectUserId: actor.id,
    before,
    reason: reason ?? (backdated ? "clock (offline sync: earlier time)" : "clock"),
    source,
  })
  return t
}

/** "Clock out later": the entry stays open and `closeDueScheduled` closes it at `t0` (whole seconds). */
function schedule(actor: Actor, e: TimeEntry, t0: number, source: RevisionSource): void {
  const t = Math.floor(t0 / 1000) * 1000
  if (t - ms(e.startAt) > MAX_ENTRY_MS) {
    throw new Validation("A clock-out can be scheduled at most 24 hours after the clock-in", {
      fields: { at: "too_late" },
    })
  }
  ensureOpenInstants(actor.user, instantOfMs(t))
  const before = snapshot("time_entry", e)
  const updated = db
    .update(timeEntries)
    .set({ scheduledEndAt: instantOfMs(t), updatedAt: utcnow() })
    .where(eq(timeEntries.id, e.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: updated,
    action: "update",
    actor,
    subjectUserId: actor.id,
    before,
    reason: `clock-out scheduled for ${localClock(t, actor.user.timezone)}`,
    source,
  })
}

function unschedule(actor: Actor, e: TimeEntry, source: RevisionSource): void {
  const before = snapshot("time_entry", e)
  const updated = db
    .update(timeEntries)
    .set({ scheduledEndAt: null, updatedAt: utcnow() })
    .where(eq(timeEntries.id, e.id))
    .returning()
    .get()
  record({
    entity: "time_entry",
    row: updated,
    action: "update",
    actor,
    subjectUserId: actor.id,
    before,
    reason: "scheduled clock-out cancelled",
    source,
  })
}

/**
 * Closes every open entry whose scheduled clock-out has passed, at exactly that time (source manual: the end
 * was chosen by hand). One transaction per entry; a failure (e.g. the month was signed off meanwhile) is
 * logged and the entry left to the person. Returns the number of closed entries.
 */
export function closeDueScheduled(userId?: number): number {
  const conds = [
    isNull(timeEntries.endAt),
    eq(timeEntries.isDeleted, false),
    isNotNull(timeEntries.scheduledEndAt),
    lte(timeEntries.scheduledEndAt, utcnow()),
  ]
  if (userId != null) conds.push(eq(timeEntries.userId, userId))
  const due = db
    .select()
    .from(timeEntries)
    .where(and(...conds))
    .all()
  let closed = 0
  for (const e of due) {
    try {
      rawSqlite().transaction(() => {
        close(loadActor(e.userId), e, ms(e.scheduledEndAt!), "manual", SCHEDULED_CLOCK_OUT_REASON)
      })()
      closed++
    } catch (err) {
      console.error(`[clock] scheduled clock-out of entry ${e.id} failed`, err)
    }
  }
  return closed
}

export interface ClockOptions extends ProjectFields {
  /** ISO instant, or local wall-clock time in the person's timezone. */
  at?: string | null
  /** The time was chosen by hand: the entry is marked as manual. */
  custom?: boolean
  note?: string
  /** web (default) | api | desktop | offline */
  source?: RevisionSource
}

export function clockAction(actor: Actor, action: ClockAction, opts: ClockOptions = {}): ClockState {
  const user = actor.user
  if (!CLOCK_ACTIONS.includes(action)) throw new Validation("Unknown clock action", { fields: { action: "invalid" } })
  closeDueScheduled(user.id)
  const current = openEntry(user.id)
  const at = opts.at ? parseInstantInput(opts.at, user.timezone) : null
  const source: RevisionSource = opts.custom && at ? "manual" : (opts.source ?? "web")
  if (action === "unschedule") {
    if (current?.scheduledEndAt) unschedule(actor, current, source)
  } else if (action === "start" || (action === "switch" && !current)) {
    if (!current) startNew(actor, clockTime(at, undefined), source, { note: opts.note, project: opts })
  } else if (action === "switch" && current) {
    switchProject(actor, current, clockTime(at, current), source, opts)
  } else if (current) {
    if (at && ms(at) > nowInstant().epochMilliseconds + FUTURE_TOLERANCE_MS) schedule(actor, current, ms(at), source)
    else close(actor, current, clockTime(at, current), source)
  }
  return clockState(user)
}

const RELABEL_MS = 60_000

/** Carry on with another project: close the running entry at `t` and start the next one at the same time. */
function switchProject(actor: Actor, current: TimeEntry, t: number, source: RevisionSource, opts: ProjectFields): void {
  const next = resolveProjectFields(actor, actor.user, opts, current)
  if (next.projectId === current.projectId) return
  if (t - ms(current.startAt) < RELABEL_MS) {
    const before = snapshot("time_entry", current)
    const updated = db
      .update(timeEntries)
      .set({ ...next, updatedAt: utcnow() })
      .where(eq(timeEntries.id, current.id))
      .returning()
      .get()
    record({
      entity: "time_entry",
      row: updated,
      action: "update",
      actor,
      subjectUserId: actor.id,
      before,
      reason: "clock (project switched)",
      source,
    })
    return
  }
  const end = close(actor, current, t, source, "clock (project switched)")
  // a forgotten clock-out was capped at 24 h: the new entry starts at the switch, not back then
  startNew(actor, Math.max(end, t), source, { project: next, continues: current })
}

/**
 * Close a running entry now (reporting sick, deactivation): at a scheduled clock-out already due, never after
 * the 24 h limit, so a forgotten clock-out is not credited for days.
 */
export function stopRunning(user: User, actor: Actor | null, reason = ""): TimeEntry | null {
  const e = openEntry(user.id)
  if (!e) return null
  const before = snapshot("time_entry", e)
  const start = ms(e.startAt)
  let end = Math.floor(nowInstant().epochMilliseconds / 1000) * 1000
  if (e.scheduledEndAt && ms(e.scheduledEndAt) < end) end = ms(e.scheduledEndAt)
  end = Math.min(Math.max(end, start + 1000), start + MAX_ENTRY_MS)
  const updated = db
    .update(timeEntries)
    .set({ endAt: instantOfMs(end), scheduledEndAt: null, updatedAt: utcnow() })
    .where(eq(timeEntries.id, e.id))
    .returning()
    .get()
  record({ entity: "time_entry", row: updated, action: "update", actor, subjectUserId: user.id, before, reason })
  return updated
}

// ------------------------------------------------------------------ offline sync

export interface OfflineAction extends ProjectFields {
  /** Client-generated id of the queued action (uuid). */
  id: string
  action: OfflineClockAction
  /** When the action happened on the device (ISO instant). */
  at: string
  note?: string
}

export interface OfflineResult {
  id: string
  status: "applied" | "duplicate" | "rejected"
  code?: string
}

const offlineKey = (userId: number, id: string) => `offline:${userId}:${id}`

/**
 * Replays queued clock actions in order, each in its own savepoint. Processed ids are remembered for
 * 30 days, so a retried upload applies nothing twice. Rejected actions (e.g. overlap, signed-off month) are
 * reported per id and not retried. A replayed stop carries the time of the click, so it closes the entry there.
 */
export function syncOffline(actor: Actor, actions: OfflineAction[]): { results: OfflineResult[]; clock: ClockState } {
  const cutoff = instantOfMs(nowInstant().epochMilliseconds - OFFLINE_KEEP_DAYS * 86_400_000)
  db.delete(appState)
    .where(and(like(appState.key, "offline:%"), lt(appState.updatedAt, cutoff)))
    .run()
  const results: OfflineResult[] = []
  for (const a of actions) {
    const key = offlineKey(actor.id, a.id)
    if (db.select({ k: appState.key }).from(appState).where(eq(appState.key, key)).get()) {
      results.push({ id: a.id, status: "duplicate" })
      continue
    }
    let result: OfflineResult
    try {
      rawSqlite().transaction(() =>
        clockAction(actor, a.action, {
          at: a.at,
          note: a.note,
          projectId: a.projectId,
          source: "offline",
        }),
      )()
      result = { id: a.id, status: "applied" }
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      result = { id: a.id, status: "rejected", code: err.code }
    }
    db.insert(appState)
      .values({ key, value: JSON.stringify(result), updatedAt: utcnow() })
      .run()
    results.push(result)
  }
  return { results, clock: clockState(actor.user) }
}
