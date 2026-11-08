import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { db, rawSqlite } from "@/server/db"
import * as s from "@/server/db/schema"
import type { AppError } from "@/server/errors"
import { loadActor, makeEntry, makeOrg, withSettings } from "@/test/factories"
import { createAbsence } from "./absences"
import { queueMail } from "./mail"
import { listNotifications } from "./notifications"
import { withOutbox } from "./outbox"
import { getUserOr404 } from "./permissions"
import { checkUserChain } from "./seals"
import {
  blockers,
  expectedGuards,
  listSignoffs,
  reopen,
  signOffMany,
  signoffDetail,
  signoffOverview,
  verifyAll,
} from "./signoffs"

vi.mock("./mail", () => ({ queueMail: vi.fn() }))

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected an error")
}

const sign = (actorId: number, userIds: number[], month = "2026-10", note = "") =>
  withOutbox(() => signOffMany(loadActor(actorId), { month, userIds, note }))
const dropGuards = () => {
  for (const { name } of rawSqlite().prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as {
    name: string
  }[])
    rawSqlite().exec(`DROP TRIGGER ${name}`)
}

let org: ReturnType<typeof makeOrg>
let entryId: number
beforeEach(() => {
  vi.mocked(queueMail).mockClear()
  org = makeOrg()
  entryId = makeEntry(org.anna.id, "2026-10-14T06:00:00.000000Z", "2026-10-14T10:00:00.000000Z").id
})

describe("sign-off", () => {
  it("a lead signs off a member: sealed, notified, figures kept", () => {
    const [res] = sign(org.lead.id, [org.anna.id], "2026-10", "checked")
    expect(res.ok).toBe(true)
    const so = res.signoff!
    expect(so).toMatchObject({
      month: "2026-10",
      active: true,
      sealVersion: 4,
      note: "checked",
      signedBy: { name: "Lea Lead" },
    })
    expect(so.figures?.workedMin).toBe(240)
    expect(so.digest).toHaveLength(64)
    expect(listNotifications(org.anna.id)[0].kind).toBe("month_signed_off")
    expect(vi.mocked(queueMail).mock.calls.map(([to, kind]) => `${to.email}:${kind}`)).toEqual([
      "anna@example.nomail:month_signed_off",
    ])
    expect([...checkUserChain(org.anna.id).values()]).toEqual(["ok"])
  })

  it("stores the snapshot figures of v1 only (digest input stays stable)", () => {
    sign(org.lead.id, [org.anna.id])
    const row = db.select().from(s.monthSignoffs).all()[0]
    expect(Object.keys(JSON.parse(row.snapshot)).sort()).toEqual(
      [
        "balance_end_min",
        "credit_min",
        "delta_min",
        "scheduled_min",
        "signed_by_name",
        "target_min",
        "target_total_min",
        "timezone",
        "user_name",
        "vacation_days",
        "worked_min",
        "workdays",
      ].sort(),
    )
  })

  it("who may sign whom", () => {
    expect(sign(org.anna.id, [org.ben.id])[0].error?.code).toBe("not_found")
    expect(sign(org.anna.id, [org.anna.id])[0].error?.code).toBe("forbidden")
    expect(sign(org.lead.id, [org.carl.id])[0].error?.code).toBe("not_found")
    expect(sign(org.lead.id, [org.lead.id])[0].error?.code).toBe("forbidden")
    expect(sign(org.admin.id, [org.carl.id])[0].error?.code).toBe("not_found")
    expect(sign(org.hr!.id, [org.lead.id, org.carl.id]).every((r) => r.ok)).toBe(true)
  })

  it("is blocked by an unfinished month, open requests, running entries and work without a required project", () => {
    expect(sign(org.lead.id, [org.anna.id], "2026-11")[0].error?.code).toBe("month_not_complete")
    createAbsence(loadActor(org.anna.id), { type: "vacation", startDate: "2026-10-20" })
    expect(sign(org.lead.id, [org.anna.id])[0].error?.code).toBe("pending_absence")
    makeEntry(org.ben.id, "2026-10-30T07:00:00.000000Z", null)
    expect(blockers(getUserOr404(org.ben.id), "2026-10")).toEqual(["running_entry"])
    withSettings({ project_mode: "required" })
    expect(blockers(getUserOr404(org.lead.id), "2026-10")).toEqual([])
    makeEntry(org.lead.id, "2026-10-15T06:00:00.000000Z", "2026-10-15T10:00:00.000000Z")
    expect(blockers(getUserOr404(org.lead.id), "2026-10")).toEqual(["projects_missing"])
    withSettings({ project_mode: "optional" })
    expect(sign(org.hr!.id, [org.lead.id])[0].ok).toBe(true)
    expect(sign(org.hr!.id, [org.lead.id])[0].error?.code).toBe("already_signed")
  })

  it("overview for leads and HR only", () => {
    const ov = signoffOverview(loadActor(org.lead.id), { month: "2026-10" })
    const rows = new Map(ov.rows.map((r) => [r.user.id, r]))
    expect([...rows.keys()].sort((a, b) => a - b)).toEqual([org.lead.id, org.anna.id, org.ben.id].sort((a, b) => a - b))
    expect(rows.get(org.anna.id)?.canSign).toBe(true)
    expect(rows.get(org.lead.id)?.canSign).toBe(false)
    expect(rows.get(org.anna.id)?.summary.workedMin).toBe(240)
    expect(signoffOverview(loadActor(org.lead.id)).month).toBe("2026-10")
    expect(err(() => signoffOverview(loadActor(org.anna.id))).code).toBe("forbidden")
    expect(signoffOverview(loadActor(org.hr!.id), { month: "2026-10" }).rows).toHaveLength(6)
  })

  it("keeps people who left without an end date in the months they recorded time", () => {
    db.update(s.users).set({ isActive: false }).where(eq(s.users.id, org.anna.id)).run()
    const ids = (month: string) => signoffOverview(loadActor(org.hr!.id), { month }).rows.map((r) => r.user.id)
    expect(ids("2026-10")).toContain(org.anna.id)
    db.update(s.users).set({ isActive: false }).where(eq(s.users.id, org.ben.id)).run()
    expect(ids("2026-10")).not.toContain(org.ben.id)
  })

  it("makes the month read-only in services and in the database", () => {
    sign(org.lead.id, [org.anna.id])
    const lead = loadActor(org.lead.id)
    expect(err(() => createAbsence(lead, { userId: org.anna.id, type: "sick", startDate: "2026-10-20" })).code).toBe(
      "period_signed_off",
    )
    expect(() => rawSqlite().prepare("UPDATE time_entries SET note = 'x' WHERE id = ?").run(entryId)).toThrow(
      /period signed off/,
    )
    expect(() => rawSqlite().prepare("UPDATE month_signoffs SET snapshot = '{}'").run()).toThrow(/immutable/)
    expect(() => rawSqlite().prepare("DELETE FROM month_signoffs").run()).toThrow(/immutable/)
    expect(createAbsence(lead, { userId: org.anna.id, type: "sick", startDate: "2026-11-03" }).status).toBe("approved")
  })
})

describe("reopen", () => {
  it("HR only, with a reason; a new sign-off chains to the old seal", () => {
    const id = sign(org.lead.id, [org.anna.id])[0].signoff!.id
    expect(err(() => reopen(loadActor(org.lead.id), id, "x")).code).toBe("forbidden")
    expect(err(() => reopen(loadActor(org.anna.id), id, "x")).code).toBe("forbidden")
    expect(err(() => reopen(loadActor(org.ben.id), id, "x")).code).toBe("not_found")
    expect(err(() => reopen(loadActor(org.hr!.id), id, " ")).fields).toEqual({ reason: "required" })
    expect(reopen(loadActor(org.hr!.id), id, "Missing customer visit").reopenedAt).not.toBeNull()
    expect(listNotifications(org.anna.id)[0].kind).toBe("month_reopened")
    expect(listNotifications(org.lead.id)[0].kind).toBe("month_reopened")
    rawSqlite().prepare("UPDATE time_entries SET note = 'fixed' WHERE id = ?").run(entryId)
    expect(err(() => reopen(loadActor(org.hr!.id), id, "again")).code).toBe("invalid_state")
    expect(sign(org.lead.id, [org.anna.id])[0].ok).toBe(true)
    const rows = db.select().from(s.monthSignoffs).orderBy(s.monthSignoffs.id).all()
    expect(rows[1].prevSeal).toBe(rows[0].seal)
    const actions = db
      .select()
      .from(s.revisions)
      .all()
      .filter((r) => r.entity === "signoff")
      .map((r) => r.action)
    expect(actions).toEqual(["signoff", "reopen", "signoff"])
    expect(listSignoffs(loadActor(org.anna.id)).map((x) => x.active)).toEqual([true, false])
    expect(listSignoffs(loadActor(org.ben.id))).toEqual([])
  })
})

describe("verification", () => {
  it("is intact, then detects edited data, forged records and removed sign-offs", () => {
    sign(org.lead.id, [org.anna.id])
    const hr = loadActor(org.hr!.id)
    expect(verifyAll(hr)).toMatchObject({
      ok: true,
      counts: { intact: 1 },
      guards: { expected: expectedGuards().length, missing: [] },
    })
    expect(expectedGuards().length).toBeGreaterThan(20)
    expect(sign(org.hr!.id, [org.anna.id], "2026-09")[0].ok).toBe(true)
    dropGuards()
    rawSqlite().prepare("UPDATE time_entries SET end_at = '2026-10-14T13:00:00.000000Z' WHERE id = ?").run(entryId)
    let v = verifyAll(hr)
    expect(v.ok).toBe(false)
    expect(v.counts.data_changed).toBe(1)
    expect(v.guards.missing).toHaveLength(expectedGuards().length)
    expect(v.problems[0]).toMatchObject({ month: "2026-10", integrity: "data_changed" })
    expect(v.problems[0].figures?.workedMin).toBe(240)
    expect(verifyAll(loadActor(org.admin.id)).problems[0].figures).toBeNull()
    expect(err(() => verifyAll(loadActor(org.lead.id))).code).toBe("forbidden")
    const first = db.select().from(s.monthSignoffs).orderBy(s.monthSignoffs.id).all()[0]
    rawSqlite().prepare(`UPDATE month_signoffs SET snapshot = '{"worked_min":99999}' WHERE id = ?`).run(first.id)
    v = verifyAll(hr)
    expect(v.counts.seal_invalid).toBe(1)
    rawSqlite().prepare("DELETE FROM month_signoffs WHERE id = ?").run(first.id)
    v = verifyAll(hr)
    expect(v.counts.chain_broken).toBe(1)
    expect(signoffDetail(hr, v.problems[0].id).integrity).toBe("chain_broken")
    expect(signoffDetail(loadActor(org.anna.id), v.problems[0].id).integrity).toBeNull()
  })

  it("reports figures that changed because a rule changed after the sign-off", () => {
    createAbsence(loadActor(org.lead.id), { userId: org.ben.id, type: "training", startDate: "2026-10-20" })
    sign(org.lead.id, [org.ben.id])
    expect(verifyAll(loadActor(org.hr!.id)).counts.intact).toBe(1)
    rawSqlite().prepare("UPDATE absence_types SET credits_time = 0 WHERE key = 'training'").run()
    expect(verifyAll(loadActor(org.hr!.id)).counts.figures_changed).toBe(1)
  })
})
