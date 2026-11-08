/**
 * Sign-off fingerprints and seals: SHA-256 of the period's time data and an HMAC-SHA256 seal, both over RFC 8785
 * canonical JSON. Key: sha256("resorixtrack-signoff:" + SIGNOFF_KEY). Seals chain per person: each seal covers
 * the previous seal of that person.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, or } from "drizzle-orm"
import { isRecord } from "@/lib/guards"
import { db } from "../db"
import { toInstant } from "../db/columns"
import { absences, balanceAdjustments, type MonthSignoff, monthSignoffs, timeEntries } from "../db/schema"
import { env } from "../env"

export type SealCheck = "ok" | "seal_mismatch" | "digest_mismatch" | "chain_broken"
/** The version new sign-offs are sealed with (stored with each seal and covered by it). */
export const SEAL_VERSION = 4

export type Canon = null | boolean | number | string | Canon[] | { [k: string]: Canon }

function toCanon(v: unknown): Canon {
  if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v
  if (Array.isArray(v)) return v.map(toCanon)
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toCanon(x)]))
  throw new Error("Not a JSON value")
}

// ------------------------------------------------------------------ RFC 8785 (JCS)

export function jcs(v: Canon): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v)
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("JCS cannot represent NaN or Infinity")
    return JSON.stringify(v)
  }
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`)
    .join(",")}}`
}

// ------------------------------------------------------------------ period data, digest, seal

export type PeriodData = {
  entries: Canon[][]
  absences: Canon[][]
  adjustments: Canon[][]
}

/** All rows that make up the period (including soft-deleted ones). */
export function periodData(
  userId: number,
  startDate: string,
  endDate: string,
  startUtc: string,
  endUtc: string,
): PeriodData {
  const s = toInstant(startUtc)
  const e = toInstant(endUtc)
  const entries = db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        lt(timeEntries.startAt, e),
        or(isNull(timeEntries.endAt), gt(timeEntries.endAt, s)),
      ),
    )
    .orderBy(asc(timeEntries.id))
    .all()
  const abs = db
    .select()
    .from(absences)
    .where(and(eq(absences.userId, userId), lte(absences.startDate, endDate), gte(absences.endDate, startDate)))
    .orderBy(asc(absences.id))
    .all()
  const adjustments = db
    .select()
    .from(balanceAdjustments)
    .where(
      and(
        eq(balanceAdjustments.userId, userId),
        gte(balanceAdjustments.effectiveDate, startDate),
        lte(balanceAdjustments.effectiveDate, endDate),
      ),
    )
    .orderBy(asc(balanceAdjustments.id))
    .all()
  return {
    entries: entries.map((x) => [
      x.id,
      x.kind,
      toInstant(x.startAt),
      x.endAt ? toInstant(x.endAt) : null,
      x.isDeleted,
      x.note,
      x.projectId,
    ]),
    absences: abs.map((a) => [a.id, a.typeId, a.startDate, a.endDate, a.startHalf, a.endHalf, a.status]),
    adjustments: adjustments.map((a) => [a.id, a.account, a.amount, a.effectiveDate, a.isDeleted]),
  }
}

export function periodDataOf(
  row: Pick<MonthSignoff, "userId" | "periodStartDate" | "periodEndDate" | "periodStartUtc" | "periodEndUtc">,
): PeriodData {
  return periodData(row.userId, row.periodStartDate, row.periodEndDate, row.periodStartUtc, row.periodEndUtc)
}

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

/** Fingerprint of the period's time data. */
export function computeDigest(data: PeriodData): string {
  return sha256hex(jcs(data))
}

export function sealKey(secret: string = env.signoffKey): Buffer {
  return createHash("sha256").update(`resorixtrack-signoff:${secret}`, "utf8").digest()
}

export type SealRow = Pick<
  MonthSignoff,
  | "userId"
  | "month"
  | "periodStartDate"
  | "periodEndDate"
  | "periodStartUtc"
  | "periodEndUtc"
  | "signedById"
  | "signedAt"
  | "snapshot"
  | "digest"
  | "prevSeal"
  | "sealVersion"
>

/** The exact bytes the HMAC covers; `v` keeps a seal from ever being read as another version. */
export function sealMessage(row: SealRow): string {
  return jcs({
    user_id: row.userId,
    month: row.month,
    start: row.periodStartDate,
    end: row.periodEndDate,
    start_utc: toInstant(row.periodStartUtc),
    end_utc: toInstant(row.periodEndUtc),
    signed_by: row.signedById,
    signed_at: toInstant(row.signedAt),
    snapshot: toCanon(JSON.parse(row.snapshot)),
    digest: row.digest,
    prev: row.prevSeal,
    v: row.sealVersion,
  })
}

export function computeSeal(row: SealRow, key: Buffer = sealKey()): string {
  return createHmac("sha256", key).update(sealMessage(row), "utf8").digest("hex")
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8")
  const y = Buffer.from(b, "utf8")
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Check one person's chain: the first problem per sign-off id (`ok` when intact). */
export function checkUserChain(userId: number, key: Buffer = sealKey()): Map<number, SealCheck> {
  const rows = db
    .select()
    .from(monthSignoffs)
    .where(eq(monthSignoffs.userId, userId))
    .orderBy(asc(monthSignoffs.id))
    .all()
  const out = new Map<number, SealCheck>()
  let prev = ""
  for (const r of rows) {
    if (r.prevSeal !== prev) out.set(r.id, "chain_broken")
    else if (!sameText(computeSeal(r, key), r.seal)) out.set(r.id, "seal_mismatch")
    else if (r.reopenedAt == null && computeDigest(periodDataOf(r)) !== r.digest) out.set(r.id, "digest_mismatch")
    else out.set(r.id, "ok")
    prev = r.seal
  }
  return out
}

/** Verify the whole chain of one person; returns problems by sign-off id (empty = all fine). */
export function verifyUserChain(userId: number): Record<number, SealCheck> {
  const out: Record<number, SealCheck> = {}
  for (const [id, check] of checkUserChain(userId)) if (check !== "ok") out[id] = check
  return out
}

/** Seal of the person's latest sign-off (the next one chains to it), or "". */
export function lastSeal(userId: number): string {
  return (
    db
      .select({ seal: monthSignoffs.seal })
      .from(monthSignoffs)
      .where(eq(monthSignoffs.userId, userId))
      .orderBy(desc(monthSignoffs.id))
      .limit(1)
      .get()?.seal ?? ""
  )
}
