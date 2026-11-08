import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { and, desc, eq, inArray, ne } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/server/db"
import { revisions, users } from "@/server/db/schema"
import { Validation } from "@/server/errors"
import { authed, tx } from "@/server/middleware"
import { computeDaysFrom, loadContext, personAccounts, summarize } from "@/server/services/accounts"
import { clockAction, clockState, syncOffline } from "@/server/services/clock"
import { CLOCK_ACTIONS, OFFLINE_ACTIONS } from "@/server/services/clock.schemas"
import { coveredFindings, periodFindings } from "@/server/services/compliance"
import {
  createEntry,
  deleteEntry,
  disputeEntry,
  editedEntryIds,
  entriesBetween,
  entryHistory,
  restoreEntry,
  serializeEntries,
  updateEntry,
  userHistory,
} from "@/server/services/entries"
import { lockedMonths } from "@/server/services/locks"
import { withOutbox } from "@/server/services/outbox"
import { type Actor, canManageUser, requireView, seesDate } from "@/server/services/permissions"
import { firstDayMissingProject, RECENT_DAYS } from "@/server/services/project-time"
import { revisionVisible } from "@/server/services/revisions"
import { getAllSettings } from "@/server/services/settings"
import { addDays, iso, localDateOf, localToday, monthBounds, rangeBoundsUtc, weekStart } from "@/server/time"

const id = z.number().int().positive()
const day = z.iso.date()
const instant = z.string().min(10).max(40)
const reason = z.string().max(500).default("")
const projectFields = { projectId: id.nullish() }

/** A period: an explicit range (max 400 days), the ISO week containing `week`, or a month `YYYY-MM`. */
const periodInput = z
  .object({
    userId: id.nullish(),
    from: day.optional(),
    to: day.optional(),
    week: day.optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    includeDeleted: z.boolean().default(false),
  })
  .refine((p) => (p.from && p.to) || p.week || p.month, { message: "from/to, week or month is required" })
export type PeriodInput = z.input<typeof periodInput>

function resolveRange(p: z.output<typeof periodInput>): [string, string] {
  if (p.week) {
    const s = weekStart(p.week)
    return [s, addDays(s, 6)]
  }
  if (p.month) return monthBounds(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)))
  const { from, to } = p
  if (!from || !to) throw new Validation("from/to, week or month is required")
  if (to < from) throw new Validation("'to' is before 'from'", { fields: { to: "before_start" } })
  if (Temporal.PlainDate.from(from).until(to).days > 400)
    throw new Validation("Range too large", { fields: { to: "too_long" } })
  return [from, to]
}

/**
 * Everything a week or month view needs in one call: per-day figures, summary, entries (incl. deleted ones on
 * request) with their projects, compliance findings, signed-off months and what the viewer may do.
 */
function periodView(actor: Actor, p: z.output<typeof periodInput>) {
  const user = p.userId == null || p.userId === actor.id ? actor.user : requireView(actor, p.userId)
  const [from, to] = resolveRange(p)
  const ctx = loadContext(user, from, to)
  const [s, e] = rangeBoundsUtc(from, to, user.timezone)
  // a lead covering from a later day sees the days from then on
  const visible = (d: string) => seesDate(actor, user, d)
  const rows = entriesBetween(user.id, s, e, p.includeDeleted).filter((r) =>
    visible(localDateOf(r.startAt, user.timezone)),
  )
  const edited = editedEntryIds(rows.map((r) => r.id))
  const days = computeDaysFrom(ctx, { editedEntryIds: edited }).filter((d) => visible(d.date))
  const pre = { timeline: ctx.timeline, settings: { at: ctx.settingsAt, changes: ctx.settingChanges } }
  const findings = coveredFindings(actor, user, periodFindings(user, from, to, undefined, pre))
  const own = user.id === actor.id
  return {
    user: { id: user.id, name: user.name, timezone: user.timezone, recordingMode: user.recordingMode },
    from,
    to,
    today: ctx.today,
    days,
    summary: summarize(days),
    entries: serializeEntries(rows, user.id),
    findings,
    lockedMonths: lockedMonths(user, from, to),
    canEdit: own || canManageUser(actor, user),
    reasonRequired: { always: !own, pastDays: getAllSettings().reason_required_for_past_edits },
  }
}
export type PeriodView = ReturnType<typeof periodView>

export const fetchPeriod = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(periodInput)
  .handler(({ data, context: { actor } }) => periodView(actor, data))

export const periodQuery = (p: PeriodInput) =>
  queryOptions({ queryKey: ["time", "period", p], queryFn: () => fetchPeriod({ data: p }) })

/** Dashboard tiles: today, this week, balance, vacation, clock, first recent day with work without a project. */
export const fetchTimeOverview = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => {
    const user = actor.user
    const today = localToday(user.timezone)
    const ws = weekStart(today)
    // one load: the week, the recent days checked for projects, the balance and the vacation account
    const acc = personAccounts(user, addDays(today, -RECENT_DAYS), addDays(ws, 6), Number(today.slice(0, 4)))
    const days = acc.days.filter((d) => d.date >= ws)
    const todayRow = days.find((d) => d.date === today)
    if (!todayRow) throw new Error("today outside its own week")
    return {
      today: todayRow,
      week: { days, summary: summarize(days) },
      balance: acc.balance,
      vacation: acc.vacation,
      clock: clockState(user),
      projectMissingDay: firstDayMissingProject(user, acc.days),
    }
  })

export const timeOverviewQuery = () =>
  queryOptions({ queryKey: ["time", "overview"], queryFn: () => fetchTimeOverview() })

// ------------------------------------------------------------------ entries

export const createEntryFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      userId: id.nullish(),
      startAt: instant,
      endAt: instant,
      note: z.string().max(500).default(""),
      ...projectFields,
      reason,
    }),
  )
  .handler(({ data, context: { actor } }) => withOutbox(() => tx(() => createEntry(actor, data))))

export const updateEntryFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      id,
      startAt: instant.optional(),
      endAt: instant.nullish(),
      note: z.string().max(500).optional(),
      ...projectFields,
      reason,
    }),
  )
  .handler(({ data: { id: entryId, reason: why, ...changes }, context: { actor } }) =>
    withOutbox(() => tx(() => updateEntry(actor, entryId, changes, why))),
  )

export const deleteEntryFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, reason }))
  .handler(({ data, context: { actor } }) => withOutbox(() => tx(() => deleteEntry(actor, data.id, data.reason))))

export const restoreEntryFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, reason }))
  .handler(({ data, context: { actor } }) => withOutbox(() => tx(() => restoreEntry(actor, data.id, data.reason))))

export const disputeEntryFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, message: z.string().min(1).max(500) }))
  .handler(({ data, context: { actor } }) => withOutbox(() => tx(() => disputeEntry(actor, data.id, data.message))))

export const fetchEntryHistory = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => entryHistory(actor, data.id))

export const entryHistoryQuery = (entryId: number) =>
  queryOptions({
    queryKey: ["time", "entry-history", entryId],
    queryFn: () => fetchEntryHistory({ data: { id: entryId } }),
  })

export const fetchUserHistory = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), limit: z.number().int().min(1).max(1000).default(200) }))
  .handler(({ data, context: { actor } }) => userHistory(actor, data.userId ?? actor.id, data.limit))

export const userHistoryQuery = (userId?: number | null) =>
  queryOptions({
    queryKey: ["time", "user-history", userId ?? null],
    queryFn: () => fetchUserHistory({ data: { userId } }),
  })

// ------------------------------------------------------------------ clock

const clockActionSchema = z.enum(CLOCK_ACTIONS)

export const fetchClock = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => clockState(actor.user))

export const clockQuery = () => queryOptions({ queryKey: ["clock"], queryFn: () => fetchClock() })

export const clockActionFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      action: clockActionSchema,
      at: instant.nullish(),
      custom: z.boolean().default(false),
      note: z.string().max(500).default(""),
      ...projectFields,
    }),
  )
  .handler(({ data, context: { actor } }) => tx(() => clockAction(actor, data.action, data)))

/** Replays clock actions queued while offline (idempotent per client action id). */
export const syncOfflineFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      actions: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            action: z.enum(OFFLINE_ACTIONS),
            at: instant,
            note: z.string().max(500).optional(),
            ...projectFields,
          }),
        )
        .max(200),
    }),
  )
  .handler(({ data, context: { actor } }) => tx(() => syncOffline(actor, data.actions)))

// ------------------------------------------------------------------ corrections

/**
 * The latest change by someone other than the owner for each of the given entries (who, when, why), so the
 * UI can show corrections with their reason inline. Only entries of a person the viewer may see.
 */
export const fetchCorrections = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), ids: z.array(id).max(500) }))
  .handler(({ data, context: { actor } }) => {
    const owner = data.userId == null || data.userId === actor.id ? actor.user : requireView(actor, data.userId)
    const out: Record<number, Correction> = {}
    if (!data.ids.length) return out
    const rows = db
      .select({ rev: revisions, by: users.name })
      .from(revisions)
      .leftJoin(users, eq(users.id, revisions.actorId))
      .where(
        and(
          eq(revisions.entity, "time_entry"),
          inArray(revisions.entityId, data.ids),
          eq(revisions.subjectUserId, owner.id),
          ne(revisions.actorId, owner.id),
          ne(revisions.action, "dispute"),
        ),
      )
      .orderBy(desc(revisions.at), desc(revisions.id))
      .all()
      .filter((r) => revisionVisible(actor, owner, r.rev))
    for (const { rev, by } of rows)
      out[rev.entityId] ??= { by: by ?? "", reason: rev.reason, at: iso(rev.at), action: rev.action }
    return out
  })

export interface Correction {
  by: string
  reason: string
  at: string
  action: string
}

export const correctionsQuery = (p: { userId?: number | null; ids: number[] }) =>
  queryOptions({
    queryKey: ["time", "corrections", p.userId ?? null, p.ids],
    queryFn: () => fetchCorrections({ data: p }),
    enabled: p.ids.length > 0,
  })
