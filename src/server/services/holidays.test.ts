import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { loadActor, makeCalendar, makeOrg } from "@/test/factories"
import { db } from "../db"
import { users } from "../db/schema"
import { holidaysFor, monthCalendarId } from "./holidays"
import { reopen, signOff, snapshotFigures } from "./signoffs"
import { updateUser } from "./users"

let org: ReturnType<typeof makeOrg>
const anna = () => db.select().from(users).where(eq(users.id, org.anna.id)).get()!
const lead = () => loadActor(org.lead.id)
/** Another calendar for Anna from today (earlier days keep theirs). */
const moveAnnaTo = (calendarId: number) =>
  updateUser(loadActor(org.admin.id), org.anna.id, { holidayCalendarId: calendarId })

beforeEach(() => {
  org = makeOrg()
})

/** May signed with calendar A, then Anna moves to calendar B from today (5 November) and HR reopens May. */
function reopenedMay() {
  const a = makeCalendar({ name: "A", isDefault: false }, [
    { date: "2026-05-14", name: "Ascension" },
    { date: "2026-05-25", name: "Whit Monday" },
  ])
  // calendar A from the start
  db.update(users).set({ holidayCalendarId: a.id }).where(eq(users.id, org.anna.id)).run()
  const first = signOff(lead(), anna(), "2026-05")
  const b = makeCalendar({ name: "B", isDefault: false }, [{ date: "2026-12-26", name: "St Stephen" }])
  moveAnnaTo(b.id)
  reopen(loadActor(org.hr!.id), first.id, "fix one entry")
  return { a, b, first }
}

describe("holiday calendar of a reopened month", () => {
  it("keeps the calendar of its days; only days from the change on follow the new one", () => {
    const { a } = reopenedMay()
    expect([...holidaysFor(anna(), "2026-05-01", "2026-12-31").keys()].sort()).toEqual([
      "2026-05-14",
      "2026-05-25",
      "2026-12-26",
    ])
    expect(monthCalendarId(anna(), "2026-05")).toBe(a.id)
    expect(monthCalendarId(anna(), "2026-10")).toBe(a.id)
    expect(monthCalendarId(anna(), "2026-12")).not.toBe(a.id)
  })

  it("signing it again freezes the same calendar and seals the same target", () => {
    const { a, first } = reopenedMay()
    const again = signOff(lead(), anna(), "2026-05")
    expect(again.calendarId).toBe(a.id)
    expect(snapshotFigures(again).targetMin).toBe(snapshotFigures(first).targetMin)
    expect([...holidaysFor(anna(), "2026-05-01", "2026-05-31").keys()]).toEqual(["2026-05-14", "2026-05-25"])
  })
})
