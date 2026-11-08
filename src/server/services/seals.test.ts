import { describe, expect, it } from "vitest"
import { db, rawSqlite } from "@/server/db"
import * as s from "@/server/db/schema"
import { makeAbsenceRow, makeAbsenceType, makeEntry, makeUser } from "@/test/factories"
import {
  checkUserChain,
  computeDigest,
  computeSeal,
  jcs,
  lastSeal,
  periodData,
  SEAL_VERSION,
  sealKey,
  sealMessage,
} from "./seals"

const key = sealKey("test-key")

/** A month of time data and its sign-off, sealed onto the person's chain. */
function sign(userId: number, month: string, reopened = false) {
  const [y, m] = month.split("-").map(Number)
  const start = `${month}-01`
  const end = Temporal.PlainDate.from({ year: y, month: m, day: 1 }).add({ months: 1 }).subtract({ days: 1 }).toString()
  const startUtc = `${start}T00:00:00.000000Z`
  const endUtc = `${Temporal.PlainDate.from(end).add({ days: 1 }).toString()}T00:00:00.000000Z`
  const row = {
    userId,
    month,
    periodStartDate: start,
    periodEndDate: end,
    periodStartUtc: startUtc,
    periodEndUtc: endUtc,
    signedById: null,
    signedAt: `${end}T20:00:00.000000Z`,
    snapshot: jcs({ worked_min: 480, user_name: "Zoë" }),
    digest: computeDigest(periodData(userId, start, end, startUtc, endUtc)),
    prevSeal: lastSeal(userId),
    sealVersion: SEAL_VERSION,
  }
  return db
    .insert(s.monthSignoffs)
    .values({ ...row, seal: computeSeal(row, key), reopenedAt: reopened ? `${end}T21:00:00.000000Z` : null })
    .returning()
    .get()
}

function person() {
  const u = makeUser({ name: "Zoë" })
  const vac = makeAbsenceType({ key: "vacation" })
  makeEntry(u.id, "2026-08-03T07:00:00.000000Z", "2026-08-03T15:00:00.000000Z")
  makeEntry(u.id, "2026-09-14T06:00:00.000000Z", "2026-09-14T10:00:00.000000Z")
  makeEntry(u.id, "2026-10-14T06:00:00.000000Z", "2026-10-14T10:00:00.000000Z")
  makeAbsenceRow(u.id, vac.id, "2026-10-20", "2026-10-21")
  db.insert(s.balanceAdjustments)
    .values({ userId: u.id, account: "time", amount: 30.5, effectiveDate: "2026-10-31", reason: "x" })
    .run()
  return u
}

function dropGuards() {
  const names = rawSqlite().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]
  for (const { name } of names) rawSqlite().exec(`DROP TRIGGER ${name}`)
}

describe("RFC 8785", () => {
  it("serialises numbers per ECMAScript and sorts keys by UTF-16 code units", () => {
    expect(jcs([1e21, 0.000001, 1e-7, -0, 30, 4.5])).toBe("[1e+21,0.000001,1e-7,0,30,4.5]")
    const obj = { "€": "Euro", "\r": "cr", "\ufb33": "Hebrew", "1": "one", "😀": "smiley", "\u0080": "ctl", ö: "o" }
    expect(jcs(obj)).toBe(
      '{"\\r":"cr","1":"one","\u0080":"ctl","\u00f6":"o","\u20ac":"Euro","\ud83d\ude00":"smiley","\ufb33":"Hebrew"}',
    )
    expect(jcs({ b: [true, null], a: "x " })).toBe('{"a":"x ","b":[true,null]}')
  })
})

describe("seals", () => {
  it("chain per person and cover the period's data", () => {
    const u = person()
    sign(u.id, "2026-08")
    sign(u.id, "2026-09", true)
    const oct = sign(u.id, "2026-10")
    expect(sealMessage(oct)).toContain(`"v":${SEAL_VERSION}`)
    expect(sealMessage(oct)).toContain('"user_name":"Zoë"')
    expect([...checkUserChain(u.id, key).values()]).toEqual(["ok", "ok", "ok"])
    expect(computeSeal({ ...oct, sealVersion: SEAL_VERSION + 1 }, key)).not.toBe(oct.seal)
  })

  it("detect edited data, forged snapshots and removed sign-offs", () => {
    const u = person()
    const aug = sign(u.id, "2026-08")
    const sep = sign(u.id, "2026-09", true)
    const oct = sign(u.id, "2026-10")
    dropGuards()
    rawSqlite()
      .prepare(
        "UPDATE time_entries SET end_at = '2026-10-14T11:00:00.000001Z' WHERE user_id = ? AND start_at LIKE '2026-10%'",
      )
      .run(u.id)
    expect(checkUserChain(u.id, key).get(oct.id)).toBe("digest_mismatch")
    // the reopened month is not fingerprinted any more, only sealed
    rawSqlite().prepare("UPDATE time_entries SET note = 'x' WHERE user_id = ? AND start_at LIKE '2026-09%'").run(u.id)
    expect(checkUserChain(u.id, key).get(sep.id)).toBe("ok")
    rawSqlite().prepare("UPDATE balance_adjustments SET amount = 31 WHERE user_id = ?").run(u.id)
    expect(checkUserChain(u.id, key).get(oct.id)).toBe("digest_mismatch")
    rawSqlite().prepare(`UPDATE month_signoffs SET snapshot = '{"worked_min": 99999}' WHERE id = ?`).run(aug.id)
    expect(checkUserChain(u.id, key).get(aug.id)).toBe("seal_mismatch")
    rawSqlite().prepare("DELETE FROM month_signoffs WHERE id = ?").run(sep.id)
    expect(checkUserChain(u.id, key).get(oct.id)).toBe("chain_broken")
  })

  it("fail with another key", () => {
    const u = person()
    const aug = sign(u.id, "2026-08")
    expect(checkUserChain(u.id, sealKey("another-key")).get(aug.id)).toBe("seal_mismatch")
  })
})
