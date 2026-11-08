/**
 * Legal minimums enforced at clock-in (setting `break_enforcement`; ArG Art. 15 and 15a). The same figures the
 * compliance engine reports as findings, applied before a new entry starts:
 *
 * - Minimum break for the time worked so far on this working day: 15 min above 5.5 h, 30 min above 7 h, 60 min above 9 h
 *   (`breakRequiredMin`). 15 and 30 min must be taken in one piece (the longest gap between the day's work
 *   entries counts, the gap running since the last clock-out included); 60 min may be split into pieces of at
 *   least 15 min.
 * - Daily rest of 11 h after the previous working day.
 *
 * Working days are grouped as in the compliance engine: gaps under 3 h continue a block, a block belongs to
 * the local day it starts, and later blocks of that day follow a break.
 *
 * Only clock-ins are blocked; a manual entry afterwards stays possible and gets the usual finding.
 */
import type { User } from "../db/schema"
import { Conflict } from "../errors"
import { instantOfMs, iso } from "../time"
import { breakRequiredMin } from "./accounts"
import {
  active,
  BLOCK_GAP_MS,
  breakGaps,
  breakTaken,
  type EntryInterval,
  rulesFrom,
  SPLIT_PIECE_MIN,
  workingBlocks,
} from "./compliance"
import { entriesBetween, ms } from "./entries"
import { getAllSettings } from "./settings"
import { dayOfMs, personTimeline } from "./timeline"

export const MIN_REST_MIN = 11 * 60
// covers a night shift and the 11 h rest before the next one
const LOOKBACK_MS = 36 * 3600_000

const r2 = (n: number) => Math.round(n * 100) / 100

/** Refuses a clock-in at `t` (epoch ms) while the legal minimum break or daily rest is not yet complete. */
export function ensureLegalRest(user: User, t: number): void {
  const st = getAllSettings()
  if (!st.break_enforcement || !active(rulesFrom(st), user) || user.recordingMode !== "full") return
  const day = workingDay(user, t)
  ensureBreakTaken(t, day)
  ensureDailyRest(t, day)
}

/**
 * The working day a clock-in at `t` belongs to (blocks as in the compliance engine, finished entries up to `t`);
 * a clock-in within 3 h of the last block continues it (a night shift stays one day).
 */
function workingDay(user: User, t: number) {
  const { tzOn } = personTimeline(user)
  const entries: EntryInterval[] = []
  for (const e of entriesBetween(user.id, instantOfMs(t - LOOKBACK_MS), instantOfMs(t)))
    if (e.endAt) entries.push({ kind: e.kind, startMs: ms(e.startAt), endMs: Math.min(ms(e.endAt), t) })
  const blocks = workingBlocks(entries, tzOn)
  const last = blocks.at(-1)
  const day = last && t - last.endMs < BLOCK_GAP_MS ? last.day : dayOfMs(t, tzOn)
  const today = blocks.filter((b) => b.day === day)
  const work = entries.filter(
    (e) => e.kind === "work" && e.endMs > e.startMs && today.some((b) => e.startMs >= b.startMs && e.startMs < b.endMs),
  )
  return { blocks: today, work, previous: blocks.findLast((b) => b.day < day) ?? null }
}

function ensureBreakTaken(t: number, { work }: ReturnType<typeof workingDay>): void {
  const workedMs = work.reduce((sum, s) => sum + s.endMs - s.startMs, 0)
  const required = breakRequiredMin(workedMs / 60000)
  if (!required) return
  const { gaps, lastEnd } = breakGaps(work)
  const taken = breakTaken([...gaps, (t - lastEnd) / 60000], required)
  if (taken + 1e-9 >= required) return
  const missing = required < 60 ? required : Math.max(required - breakTaken(gaps, required), SPLIT_PIECE_MIN)
  throw new Conflict(`The legal minimum break of ${required} min has not been taken yet`, {
    code: "break_required",
    fields: { required, taken: r2(taken), earliest: iso(instantOfMs(lastEnd + missing * 60000)) },
  })
}

/** Only the first clock-in of a working day needs the rest; later ones end a break. */
function ensureDailyRest(t: number, { blocks, previous }: ReturnType<typeof workingDay>): void {
  if (blocks.length || !previous) return
  if (t - previous.endMs >= MIN_REST_MIN * 60000) return
  throw new Conflict("The daily rest of 11 hours is not complete yet", {
    code: "rest_required",
    fields: { requiredMin: MIN_REST_MIN, earliest: iso(instantOfMs(previous.endMs + MIN_REST_MIN * 60000)) },
  })
}
