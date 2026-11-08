import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { db, rawSqlite } from "@/server/db"
import { users } from "@/server/db/schema"
import type { AppError } from "@/server/errors"
import { freeze } from "@/server/time"
import { loadActor, lockMonth, makeEntry, makeLead, makeOrg, withSettings } from "@/test/factories"
import {
  absenceHistory,
  absencePreview,
  cancelAbsence,
  createAbsence,
  decideAbsence,
  getAbsenceDto,
  listAbsences,
  pendingForApprover,
  reportSickToday,
  selfSickAllowed,
  updateAbsence,
} from "./absences"
import { vacationAccount } from "./accounts"
import { openEntry } from "./clock"
import { queueMail } from "./mail"
import { listNotifications } from "./notifications"
import { withOutbox } from "./outbox"
import { getUserOr404 } from "./permissions"

vi.mock("./mail", () => ({ queueMail: vi.fn() }))
const mails = () => vi.mocked(queueMail).mock.calls.map(([to, kind]) => `${to.email}:${kind}`)

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected an error")
}

const kinds = (userId: number) => listNotifications(userId).map((n) => n.kind)
const vac = (actorId: number, start: string, end = start, extra: Record<string, unknown> = {}) =>
  withOutbox(() => createAbsence(loadActor(actorId), { type: "vacation", startDate: start, endDate: end, ...extra }))

let org: ReturnType<typeof makeOrg>
beforeEach(() => {
  vi.mocked(queueMail).mockClear()
  org = makeOrg()
})

describe("vacation workflow", () => {
  it("request, approve by the lead, accounts and notifications", () => {
    const a = vac(org.anna.id, "2026-12-14", "2026-12-18", { note: "Skiing" })
    const dto = getAbsenceDto(loadActor(org.anna.id), a.id)
    expect(dto.status).toBe("pending")
    expect(dto.days).toBe(5)
    expect(dto.permissions).toMatchObject({ cancel: true, decide: false, edit: true })
    expect(kinds(org.lead.id)).toEqual(["absence_requested"])
    expect(mails()).toContain("lea@example.nomail:absence_requested")
    expect(pendingForApprover(loadActor(org.lead.id)).map((x) => x.id)).toEqual([a.id])
    expect(getAbsenceDto(loadActor(org.lead.id), a.id).permissions?.decide).toBe(true)
    const before = vacationAccount(getUserOr404(org.anna.id), 2026)
    expect(before.pending).toBe(5)

    withOutbox(() => decideAbsence(loadActor(org.lead.id), a.id, true, "Enjoy!"))
    const approved = getAbsenceDto(loadActor(org.anna.id), a.id)
    expect(approved.status).toBe("approved")
    expect(approved.decidedBy?.name).toBe("Lea Lead")
    const after = vacationAccount(getUserOr404(org.anna.id), 2026)
    expect(after.planned).toBe(5)
    expect(after.pending).toBe(0)
    expect(after.remaining).toBe(before.remaining - 5)
    expect(mails()).toContain("anna@example.nomail:absence_approved")
    expect(err(() => decideAbsence(loadActor(org.lead.id), a.id, false)).code).toBe("invalid_state")
  })

  it("reject notifies the person", () => {
    const a = vac(org.anna.id, "2026-12-14")
    decideAbsence(loadActor(org.lead.id), a.id, false, "Release week")
    expect(getAbsenceDto(loadActor(org.anna.id), a.id).status).toBe("rejected")
    expect(kinds(org.anna.id)[0]).toBe("absence_rejected")
  })

  it("counts working days without weekends and holidays, with half days", () => {
    expect(getAbsenceDto(loadActor(org.anna.id), vac(org.anna.id, "2026-12-21", "2026-12-27").id).days).toBe(4)
    const half = vac(org.anna.id, "2026-12-28", "2026-12-29", { startHalf: "pm", endHalf: "am" })
    expect(getAbsenceDto(loadActor(org.anna.id), half.id).days).toBe(1)
    const am = vac(org.anna.id, "2026-12-30", "2026-12-30", { startHalf: "am", endHalf: "am" })
    expect(getAbsenceDto(loadActor(org.anna.id), am.id).days).toBe(0.5)
    expect(err(() => vac(org.anna.id, "2026-12-14", "2026-12-15", { startHalf: "am" })).fields).toEqual({
      startHalf: "invalid",
    })
    expect(err(() => vac(org.anna.id, "2026-12-14", "2026-12-15", { endHalf: "pm" })).fields).toEqual({
      endHalf: "invalid",
    })
    expect(err(() => vac(org.anna.id, "2026-12-15", "2026-12-14")).fields).toEqual({ endDate: "before_start" })
  })

  it("refuses overlaps but allows the other half of a day", () => {
    vac(org.anna.id, "2026-12-14", "2026-12-18")
    expect(err(() => vac(org.anna.id, "2026-12-16")).code).toBe("absence_overlap")
    vac(org.anna.id, "2026-12-21", "2026-12-21", { startHalf: "am" })
    expect(vac(org.anna.id, "2026-12-21", "2026-12-21", { startHalf: "pm" }).status).toBe("pending")
    expect(err(() => vac(org.anna.id, "2026-12-21")).code).toBe("absence_overlap")
  })

  it("refuses a period without working days", () => {
    const e = err(() => vac(org.anna.id, "2026-12-12", "2026-12-13"))
    expect(e.status).toBe(422)
    expect(e.fields).toEqual({ endDate: "no_workdays" })
  })

  it("leads decide only for their teams, never for themselves; HR covers teams without lead", () => {
    const c = vac(org.carl.id, "2026-12-14")
    expect(err(() => decideAbsence(loadActor(org.lead.id), c.id, true)).code).toBe("not_found")
    expect(pendingForApprover(loadActor(org.lead.id))).toEqual([])
    expect(kinds(org.hr!.id)).toEqual(["absence_requested"])
    expect(pendingForApprover(loadActor(org.hr!.id)).map((x) => x.id)).toEqual([c.id])
    expect(decideAbsence(loadActor(org.hr!.id), c.id, true).status).toBe("approved")
    const own = vac(org.lead.id, "2026-12-21")
    expect(err(() => decideAbsence(loadActor(org.lead.id), own.id, true)).code).toBe("forbidden")
    expect(pendingForApprover(loadActor(org.hr!.id)).map((x) => x.id)).toContain(own.id)
    // administrators without HR see neither the request nor the person's data
    expect(pendingForApprover(loadActor(org.admin.id))).toEqual([])
    expect(err(() => getAbsenceDto(loadActor(org.admin.id), own.id)).code).toBe("not_found")
  })

  it("employees cannot decide", () => {
    const a = vac(org.anna.id, "2026-12-14")
    expect(err(() => decideAbsence(loadActor(org.ben.id), a.id, true)).code).toBe("not_found")
    expect(err(() => decideAbsence(loadActor(org.anna.id), a.id, true)).code).toBe("forbidden")
  })

  it("deputies decide only within their period", () => {
    makeLead(org.teamA.id, org.ben.id, { role: "deputy", validFrom: "2026-11-01", validTo: "2026-11-30" })
    const a = vac(org.anna.id, "2026-12-14")
    expect(decideAbsence(loadActor(org.ben.id), a.id, true).status).toBe("approved")
    freeze("2026-12-01T08:00:00Z")
    const b = vac(org.anna.id, "2026-12-15")
    expect(err(() => decideAbsence(loadActor(org.ben.id), b.id, true)).code).toBe("not_found")
  })

  it("a deputy decides a request that reaches into the cover", () => {
    makeLead(org.teamA.id, org.ben.id, { role: "deputy", validFrom: "2026-11-10" })
    const a = vac(org.anna.id, "2026-11-09", "2026-11-11")
    freeze("2026-11-10T08:00:00Z")
    expect(pendingForApprover(loadActor(org.ben.id)).map((x) => x.id)).toContain(a.id)
    expect(decideAbsence(loadActor(org.ben.id), a.id, true).status).toBe("approved")
  })

  it("requests of people who left stay in the inbox", () => {
    const a = vac(org.anna.id, "2026-12-14")
    db.update(users).set({ isActive: false }).where(eq(users.id, org.anna.id)).run()
    expect(pendingForApprover(loadActor(org.lead.id)).map((x) => x.id)).toContain(a.id)
  })

  it("lead records an absence directly (approved, person informed)", () => {
    const a = withOutbox(() =>
      createAbsence(loadActor(org.lead.id), { userId: org.anna.id, type: "vacation", startDate: "2026-12-14" }),
    )
    expect(a.status).toBe("approved")
    expect(kinds(org.anna.id)).toEqual(["absence_recorded"])
    expect(mails()).toEqual(["anna@example.nomail:absence_recorded"])
    expect(
      err(() =>
        createAbsence(loadActor(org.lead.id), { userId: org.carl.id, type: "vacation", startDate: "2026-12-14" }),
      ).code,
    ).toBe("not_found")
  })

  it("HR's own requests go to someone else like everybody's", () => {
    const a = vac(org.hr!.id, "2026-12-14")
    expect(a.status).toBe("pending")
    expect(err(() => decideAbsence(loadActor(org.hr!.id), a.id, true)).code).toBe("forbidden")
  })

  it("previews days and vacation left", () => {
    const p = absencePreview(loadActor(org.anna.id), {
      startDate: "2026-12-21",
      endDate: "2026-12-31",
      type: "vacation",
    })
    expect(p.days).toBe(8)
    expect(p.vacationAfter).toBe(p.vacationRemaining - 8)
    expect(
      err(() => absencePreview(loadActor(org.ben.id), { userId: org.anna.id, startDate: "2026-12-21" })).code,
    ).toBe("not_found")
  })

  it("previewing a change does not count the edited request twice", () => {
    const before = absencePreview(loadActor(org.anna.id), { startDate: "2026-12-14", type: "vacation" })
    const req = vac(org.anna.id, "2026-12-14", "2026-12-15")
    const input = { startDate: "2026-12-14", type: "vacation", excludeId: req.id }
    expect(absencePreview(loadActor(org.anna.id), input).vacationAfter).toBe(before.vacationAfter)
    expect(absencePreview(loadActor(org.anna.id), { ...input, excludeId: null }).vacationAfter).toBe(
      before.vacationAfter - 2,
    )
    // another person's request id changes nothing
    const other = vac(org.ben.id, "2026-12-14")
    expect(absencePreview(loadActor(org.anna.id), { ...input, excludeId: other.id }).vacationAfter).toBe(
      before.vacationAfter - 2,
    )
  })
})

describe("cancel and change", () => {
  it("applies the cancel rules per status and role", () => {
    const anna = () => loadActor(org.anna.id)
    const lead = () => loadActor(org.lead.id)
    const a = vac(org.anna.id, "2026-12-14")
    expect(cancelAbsence(anna(), a.id).status).toBe("cancelled")
    expect(err(() => cancelAbsence(anna(), a.id)).code).toBe("invalid_state")
    const b = vac(org.anna.id, "2026-12-15")
    decideAbsence(lead(), b.id, true)
    expect(cancelAbsence(anna(), b.id).status).toBe("cancelled")
    expect(kinds(org.lead.id)[0]).toBe("absence_cancelled_by_owner")
    const c = vac(org.anna.id, "2026-11-02", "2026-11-03")
    decideAbsence(lead(), c.id, true)
    expect(err(() => cancelAbsence(anna(), c.id)).code).toBe("forbidden")
    expect(err(() => cancelAbsence(lead(), c.id)).fields).toEqual({ reason: "required" })
    vi.mocked(queueMail).mockClear()
    const done = withOutbox(() => cancelAbsence(lead(), c.id, "Came to work after all"))
    expect(done.cancelReason).toBe("Came to work after all")
    expect(mails()).toEqual(["anna@example.nomail:absence_cancelled"])
    expect(absenceHistory(anna(), c.id).map((h) => h.action)).toEqual(["create", "approve", "cancel"])
  })

  it("a manager's change needs a reason and is logged and notified", () => {
    const a = createAbsence(loadActor(org.lead.id), {
      userId: org.anna.id,
      type: "vacation",
      startDate: "2026-12-14",
      endDate: "2026-12-15",
    })
    expect(err(() => updateAbsence(loadActor(org.lead.id), a.id, { endDate: "2026-12-16" })).fields).toEqual({
      reason: "required",
    })
    updateAbsence(loadActor(org.lead.id), a.id, { endDate: "2026-12-16", reason: "Extended" })
    const hist = absenceHistory(loadActor(org.anna.id), a.id)
    expect(hist.at(-1)).toMatchObject({ action: "update", reason: "Extended", changed: ["end_date"] })
    expect(kinds(org.anna.id)[0]).toBe("absence_changed")
    // employees cannot change approved vacation
    expect(err(() => updateAbsence(loadActor(org.anna.id), a.id, { endDate: "2026-12-17" })).code).toBe("forbidden")
  })
})

describe("sick reports", () => {
  it("one click sick today stops the clock and informs the lead", () => {
    makeEntry(org.anna.id, "2026-11-05T07:00:00.000000Z", null)
    freeze("2026-11-05T08:05:00Z")
    expect(selfSickAllowed(getUserOr404(org.anna.id))).toEqual({ allowed: true, reason: null })
    const a = withOutbox(() => reportSickToday(loadActor(org.anna.id), "Fever"))
    expect(a.status).toBe("approved")
    expect(openEntry(org.anna.id)).toBeUndefined()
    expect(selfSickAllowed(getUserOr404(org.anna.id)).reason).toBe("already_sick")
    expect(kinds(org.lead.id)).toEqual(["absence_reported"])
    expect(mails()).toContain("lea@example.nomail:absence_reported")
    // health notes never leave the app by mail
    expect(vi.mocked(queueMail).mock.calls[0][2]?.note).toBe("")
  })

  it("is refused on days off, holidays, vacation, in advance and too far back", () => {
    const sick = (d: string) => () => createAbsence(loadActor(org.anna.id), { type: "sick", startDate: d })
    freeze("2026-11-07T09:00:00Z")
    expect(err(sick("2026-11-07")).code).toBe("not_a_workday")
    freeze("2026-12-08T09:00:00Z")
    expect(err(sick("2026-12-08")).code).toBe("public_holiday")
    createAbsence(loadActor(org.lead.id), { userId: org.anna.id, type: "vacation", startDate: "2026-12-09" })
    freeze("2026-12-09T09:00:00Z")
    expect(err(sick("2026-12-09")).code).toBe("on_vacation")
    expect(err(sick("2026-12-11")).fields).toEqual({ startDate: "future" })
    expect(err(sick("2026-12-01")).fields).toEqual({ startDate: "too_old" })
    withSettings({ sick_self_report_max_days: 2 })
    freeze("2026-12-17T09:00:00Z")
    expect(
      err(() => createAbsence(loadActor(org.anna.id), { type: "sick", startDate: "2026-12-15", endDate: "2026-12-17" }))
        .fields,
    ).toEqual({ endDate: "too_long" })
  })

  it("leads mark members sick; some types only leads or HR record", () => {
    const a = withOutbox(() =>
      createAbsence(loadActor(org.lead.id), {
        userId: org.anna.id,
        type: "sick",
        startDate: "2026-11-02",
        endDate: "2026-11-04",
      }),
    )
    expect(a.status).toBe("approved")
    expect(mails()).toContain("anna@example.nomail:absence_recorded")
    expect(err(() => createAbsence(loadActor(org.anna.id), { type: "accident", startDate: "2026-11-05" })).code).toBe(
      "type_not_requestable",
    )
    expect(
      createAbsence(loadActor(org.hr!.id), { userId: org.anna.id, type: "accident", startDate: "2026-11-05" }).status,
    ).toBe("approved")
  })

  it("the person extends their own sick report but cannot move its start", () => {
    const a = createAbsence(loadActor(org.anna.id), { type: "sick", startDate: "2026-11-05" })
    expect(
      getAbsenceDto(loadActor(org.anna.id), updateAbsence(loadActor(org.anna.id), a.id, { endDate: "2026-11-06" }).id)
        .days,
    ).toBe(2)
    expect(err(() => updateAbsence(loadActor(org.anna.id), a.id, { startDate: "2026-11-04" })).code).toBe("forbidden")
  })

  it("extending one's own sick report later keeps the backdating limit and informs the lead", () => {
    const a = createAbsence(loadActor(org.anna.id), { type: "sick", startDate: "2026-11-02" })
    const before = kinds(org.lead.id).filter((k) => k === "absence_reported").length
    withOutbox(() => updateAbsence(loadActor(org.anna.id), a.id, { endDate: "2026-11-05" }))
    expect(kinds(org.lead.id).filter((k) => k === "absence_reported")).toHaveLength(before + 1)
    freeze("2026-11-20T08:00:00Z")
    expect(err(() => updateAbsence(loadActor(org.anna.id), a.id, { endDate: "2026-11-06" })).fields).toEqual({
      endDate: "too_old",
    })
  })
})

describe("sign-off locks", () => {
  it("blocks every write in a signed-off month (service and database)", () => {
    const inOct = createAbsence(loadActor(org.lead.id), {
      userId: org.anna.id,
      type: "vacation",
      startDate: "2026-10-20",
    })
    lockMonth(org.anna.id, "2026-10")
    const lead = loadActor(org.lead.id)
    expect(err(() => createAbsence(lead, { userId: org.anna.id, type: "sick", startDate: "2026-10-21" })).code).toBe(
      "period_signed_off",
    )
    expect(
      err(() =>
        createAbsence(lead, { userId: org.anna.id, type: "vacation", startDate: "2026-10-30", endDate: "2026-11-03" }),
      ).code,
    ).toBe("period_signed_off")
    expect(err(() => cancelAbsence(lead, inOct.id, "x")).code).toBe("period_signed_off")
    expect(err(() => updateAbsence(lead, inOct.id, { note: "x", reason: "x" })).code).toBe("period_signed_off")
    expect(() => rawSqlite().prepare("UPDATE absences SET status = 'cancelled' WHERE id = ?").run(inOct.id)).toThrow(
      /period signed off/,
    )
    // November stays open
    expect(createAbsence(lead, { userId: org.anna.id, type: "vacation", startDate: "2026-11-03" }).status).toBe(
      "approved",
    )
  })
})

describe("visibility", () => {
  it("lists only what the actor may see", () => {
    vac(org.anna.id, "2026-12-14")
    vac(org.carl.id, "2026-12-14")
    const range = { from: "2026-12-01", to: "2026-12-31" }
    expect(listAbsences(loadActor(org.anna.id), range).map((a) => a.user.id)).toEqual([org.anna.id])
    expect(listAbsences(loadActor(org.lead.id), range).map((a) => a.user.id)).toEqual([org.anna.id])
    expect(listAbsences(loadActor(org.hr!.id), range)).toHaveLength(2)
    expect(listAbsences(loadActor(org.admin.id), range)).toEqual([])
    expect(listAbsences(loadActor(org.lead.id), { ...range, teamId: org.teamB.id })).toEqual([])
    expect(err(() => listAbsences(loadActor(org.ben.id), { ...range, userId: org.anna.id })).code).toBe("not_found")
  })
})

describe("last resort", () => {
  it("administrators decide when a team has no lead and nobody has HR", () => {
    rawSqlite().prepare("UPDATE users SET capabilities = '[]'").run()
    const c = vac(org.carl.id, "2026-12-14")
    const admin = loadActor(org.admin.id)
    expect(kinds(org.admin.id)).toEqual(["absence_requested"])
    expect(pendingForApprover(admin).map((x) => x.id)).toEqual([c.id])
    expect(getAbsenceDto(admin, c.id).permissions?.decide).toBe(true)
    expect(decideAbsence(admin, c.id, true).status).toBe("approved")
    // once decided, the person's data is out of reach again
    expect(err(() => getAbsenceDto(admin, c.id)).code).toBe("not_found")
    expect(pendingForApprover(loadActor(org.lead.id))).toEqual([])
  })
})
