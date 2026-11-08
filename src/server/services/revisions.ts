/**
 * Change log. Every write to time-relevant data calls `record` inside the same transaction
 * (who, when, what, why). The table is append-only (database trigger). Snapshot keys are snake_case,
 * identical to v1, so imported history and new history read the same.
 */
import { and, asc, eq } from "drizzle-orm"
import { toJson } from "@/lib/guards"
import type { JsonObject } from "@/lib/json"
import { db } from "../db"
import { type Revision, revisions, type User } from "../db/schema"
import { iso, localDateOf } from "../time"
import { type Actor, dataFrom, seesDate } from "./permissions"

export const SNAPSHOT_KEYS = {
  time_entry: ["kind", "start_at", "end_at", "scheduled_end_at", "tz", "note", "project_id", "source", "is_deleted"],
  absence: [
    "type_id",
    "start_date",
    "end_date",
    "start_half",
    "end_half",
    "note",
    "status",
    "decision_note",
    "cancel_reason",
  ],
  adjustment: ["account", "amount", "effective_date", "kind", "reason", "is_deleted"],
  schedule: [
    "valid_from",
    "pensum_percent",
    "minutes_mon",
    "minutes_tue",
    "minutes_wed",
    "minutes_thu",
    "minutes_fri",
    "minutes_sat",
    "minutes_sun",
  ],
  entitlement: ["year", "days", "note"],
  attachment: ["absence_id", "filename", "content_type", "size", "sha256", "is_deleted"],
  user: [
    "email",
    "name",
    "role",
    "team_id",
    "holiday_calendar_id",
    "timezone",
    "employment_start",
    "employment_end",
    "vacation_days_per_year",
    "is_active",
    "capabilities",
    "locale",
    "legal_weekly_max_hours",
    "recording_mode",
    "arg_exempt",
    "regular_night_work",
    "birth_date",
  ],
  project: ["name", "code", "color", "description", "team_id", "is_active"],
  api_token: ["name", "start", "scopes", "enabled", "expires_at"],
  holiday: ["calendar_id", "date", "name", "fraction"],
} as const
export type RevisionEntity = keyof typeof SNAPSHOT_KEYS

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const INSTANT_KEYS = new Set(["scheduled_end_at", "start_at", "end_at"])

/** Snapshot of a row (camelCase drizzle object) in the stored snake_case form. */
export function snapshot(entity: RevisionEntity, row: Record<string, unknown>): JsonObject {
  const out: JsonObject = {}
  for (const k of SNAPSHOT_KEYS[entity]) {
    const v = row[camel(k)]
    out[k] = INSTANT_KEYS.has(k) && typeof v === "string" ? iso(v) : toJson(v ?? null)
  }
  return out
}

export function record(opts: {
  entity: RevisionEntity
  row: Record<string, unknown> & { id: number }
  /** create | update | delete | restore | approve | reject | cancel | purge | anonymize | … */
  action: string
  actor: Actor | null
  subjectUserId: number | null
  before: JsonObject | null
  reason?: string
  source?: string
}): void {
  const after = opts.action === "purge" ? null : snapshot(opts.entity, opts.row)
  db.insert(revisions)
    .values({
      entity: opts.entity,
      entityId: opts.row.id,
      subjectUserId: opts.subjectUserId,
      actorId: opts.actor?.id ?? null,
      action: opts.action,
      before: opts.before,
      after,
      reason: (opts.reason ?? "").trim().slice(0, 500),
      source: opts.source ?? "web",
    })
    .run()
}

export function history(entity: RevisionEntity, entityId: number): Revision[] {
  return db
    .select()
    .from(revisions)
    .where(and(eq(revisions.entity, entity), eq(revisions.entityId, entityId)))
    .orderBy(asc(revisions.at), asc(revisions.id))
    .all()
}

export function serializeRevision(rev: Revision, actorName?: string | null) {
  const changed =
    rev.before && rev.after
      ? Object.keys(rev.after)
          .filter((k) => JSON.stringify(rev.before![k]) !== JSON.stringify(rev.after![k]))
          .sort()
      : []
  return {
    id: rev.id,
    entity: rev.entity,
    entityId: rev.entityId,
    action: rev.action,
    actor: rev.actorId ? { id: rev.actorId, name: actorName ?? "" } : null,
    subjectUserId: rev.subjectUserId,
    before: rev.before,
    after: rev.after,
    changed,
    reason: rev.reason,
    source: rev.source,
    at: iso(rev.at),
  }
}

/** The day a snapshot is about: an absence by its last day, everything else by its (first) day. */
function snapshotDay(snap: JsonObject, tz: string): string | null {
  const str = (k: string) => {
    const v = snap[k]
    return typeof v === "string" ? v : null
  }
  const end = str("end_date")
  if (end) return end
  const start = str("start_at")
  if (start) return localDateOf(start, tz)
  const day = str("effective_date") ?? str("date") ?? str("valid_from") ?? str("period_start_date")
  if (day) return day
  const month = str("month")
  if (month) return `${month}-01`
  return typeof snap.year === "number" ? `${snap.year}-01-01` : null
}

/** A lead covering from a given day sees no change of a record dated before it (the snapshots hold its data). */
export function revisionVisible(actor: Actor, owner: User, rev: Revision): boolean {
  if (dataFrom(actor, owner) == null) return true
  return [rev.before, rev.after].every((snap) => {
    const day = snap ? snapshotDay(snap, owner.timezone) : null
    return day == null || seesDate(actor, owner, day)
  })
}
