/**
 * Sign-off locks (port of v1 services/signoffs.py `ensure_open_*`). While a month of a person is signed off
 * (and not reopened), every write path refuses changes to that person's time data in it. The database
 * triggers (drizzle/0001_guards.sql) enforce the same rule again.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lte, max } from "drizzle-orm"
import { db } from "../db"
import { type MonthSignoff, monthSignoffs, type User, users } from "../db/schema"
import { Conflict } from "../errors"
import { addDays, iso } from "../time"

const active = (userId: number) => and(eq(monthSignoffs.userId, userId), isNull(monthSignoffs.reopenedAt))

export function signedMonthsOverlapping(userId: number, start: string, end: string): MonthSignoff[] {
  return db
    .select()
    .from(monthSignoffs)
    .where(and(active(userId), lte(monthSignoffs.periodStartDate, end), gte(monthSignoffs.periodEndDate, start)))
    .orderBy(asc(monthSignoffs.month))
    .all()
}

function signerNames(rows: MonthSignoff[]): Map<number, string> {
  const ids = [...new Set(rows.map((r) => r.signedById).filter((x): x is number => x != null))]
  if (!ids.length) return new Map()
  return new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids))
      .all()
      .map((u) => [u.id, u.name]),
  )
}

function raise(rows: MonthSignoff[]): never {
  const months = rows.map((r) => r.month)
  const by = rows[0].signedById != null ? (signerNames(rows).get(rows[0].signedById) ?? "?") : "?"
  throw new Conflict(`${months.join(", ")} has been signed off by ${by} and can no longer be changed`, {
    code: "period_signed_off",
    fields: { months },
  })
}

/** Refuse changes to days [start, end] (person's local dates). */
export function ensureOpenDates(user: Pick<User, "id">, start: string, end?: string | null): void {
  const rows = signedMonthsOverlapping(user.id, start, end ?? start)
  if (rows.length) raise(rows)
}

/**
 * Refuse changes touching a signed-off month between the earliest and the latest of the given instants (null
 * ones are ignored). Uses the sign-offs' stored UTC bounds, like the database guards, so it holds whatever the
 * person's timezone is today.
 */
export function ensureOpenInstants(user: Pick<User, "id">, ...instants: (string | null | undefined)[]): void {
  const sorted = instants
    .filter((x): x is string => !!x)
    .map((x) => Temporal.Instant.from(x).toString({ smallestUnit: "microsecond" }))
    .sort()
  if (!sorted.length) return
  const rows = db
    .select()
    .from(monthSignoffs)
    .where(
      and(
        active(user.id),
        // a range ending exactly when a signed-off month starts still touches it
        lte(monthSignoffs.periodStartUtc, sorted.at(-1)!),
        gt(monthSignoffs.periodEndUtc, sorted[0]),
      ),
    )
    .orderBy(asc(monthSignoffs.month))
    .all()
  if (rows.length) raise(rows)
}

export function ensureScheduleChangeAllowed(user: Pick<User, "id">, validFrom: string): void {
  const rows = db
    .select()
    .from(monthSignoffs)
    .where(and(active(user.id), gte(monthSignoffs.periodEndDate, validFrom)))
    .orderBy(asc(monthSignoffs.month))
    .all()
  if (rows.length) {
    throw new Conflict(
      `A schedule starting ${validFrom} would change the signed-off month(s) ${rows.map((r) => r.month).join(", ")}`,
      {
        code: "period_signed_off",
        fields: { validFrom: "signed_off" },
      },
    )
  }
}

/** Last day covered by an active sign-off of `userId`, or of anyone (holidays up to it are frozen for everyone). */
export function latestSignedDate(userId?: number): string | null {
  return (
    db
      .select({ d: max(monthSignoffs.periodEndDate) })
      .from(monthSignoffs)
      .where(userId != null ? active(userId) : isNull(monthSignoffs.reopenedAt))
      .get()?.d ?? null
  )
}

/** Refuse a dated change (settings, terms) applying from `from` on or before the last signed-off day. */
export function ensureAfterLastSignOff(from: string, field: string, userId?: number): void {
  const latest = latestSignedDate(userId)
  if (latest != null && from <= latest)
    throw new Conflict(`Changes can apply from ${addDays(latest, 1)} on, after the last signed-off month`, {
      code: "period_signed_off",
      fields: { [field]: "signed_off" },
    })
}

export function ensureHolidayChangeAllowed(date: string): void {
  const latest = latestSignedDate()
  if (latest != null && date <= latest) {
    throw new Conflict(`Holidays on or before ${latest} belong to signed-off months and can no longer be changed`, {
      code: "period_signed_off",
      fields: { date: "signed_off" },
    })
  }
}

export interface LockedMonth {
  id: number
  signedBy: string | null
  signedAt: string
  note: string
}

/** Signed-off months overlapping [start, end], keyed by `YYYY-MM`. */
export function lockedMonths(user: Pick<User, "id">, start: string, end: string): Record<string, LockedMonth> {
  const rows = signedMonthsOverlapping(user.id, start, end)
  const names = signerNames(rows)
  const out: Record<string, LockedMonth> = {}
  for (const r of rows) {
    out[r.month] = {
      id: r.id,
      signedBy: r.signedById != null ? (names.get(r.signedById) ?? null) : null,
      signedAt: iso(r.signedAt),
      note: r.note,
    }
  }
  return out
}
