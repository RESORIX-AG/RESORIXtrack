import { addDays, expect, goto, PEOPLE, pick, previousMonth, rows, test, toast, weekday, zurichDay } from "./fixtures"

const mondayOf = (day: string) => addDays(day, -weekday(day))
/** The week label as the app writes it ("2 – 8 Nov 2026"), ICU's thin spaces as plain ones. */
const weekLabel = (monday: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .formatRange(new Date(`${monday}T12:00:00Z`), new Date(`${addDays(monday, 6)}T12:00:00Z`))
    .replace(/\u2009/gu, " ")

test("lead corrects an entry with a reason; the employee sees it highlighted", async ({ as }, info) => {
  const lead = await as("jonas")
  await goto(lead, "/team")
  await expect(lead.getByRole("heading", { level: 1, name: "Team" })).toBeVisible()
  await rows(lead).filter({ hasText: PEOPLE.mia.name }).first().click()
  await expect(lead.getByRole("heading", { level: 1, name: /Mia Brunner/ })).toBeVisible()

  // last week always has finished days; both projects correct a different entry of Mia's
  const lastMonday = mondayOf(addDays(zurichDay(), -7))
  const panel = lead.getByRole("tabpanel", { name: "Time" })
  await panel.getByRole("button", { name: "Previous" }).click()
  await expect(panel).toContainText(weekLabel(lastMonday))
  // the rows follow once the week has loaded (the previous week stays on screen meanwhile)
  await expect(panel).toContainText(new RegExp(`Mon\\s*${lastMonday.slice(8, 10)}/${lastMonday.slice(5, 7)}`))
  const entries = lead.getByRole("button", { name: /^Work \d{2}:\d{2}–\d{2}:\d{2}$/ })
  await expect(entries.first()).toBeVisible()
  const label = (await entries.nth(pick(info, 0, 1)).getAttribute("aria-label")) ?? ""
  const [, from, to] = label.match(/(\d{2}:\d{2})–(\d{2}:\d{2})/) ?? []
  // ten minutes shorter never overlaps the next entry
  const [h, m] = to.split(":").map(Number)
  const end = h * 60 + m - 10
  const newTo = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`

  await lead.getByRole("button", { name: label, exact: true }).click()
  const dialog = lead.getByRole("dialog", { name: "Edit entry" })
  await dialog.getByLabel("End").fill(newTo)
  await lead.keyboard.press("Tab") // closes the time suggestions
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog.getByText("Enter a reason.")).toBeVisible()
  await dialog.getByLabel(/^Reason/).fill("E2E: meeting ended earlier")
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
  await expect(lead.getByRole("button", { name: `Work ${from}–${newTo} · Corrected` })).toBeVisible()

  const employee = await as("mia")
  await goto(employee, `/time?date=${lastMonday}`)
  await expect(
    employee.getByRole("button", { name: new RegExp(`^Work ${from}–${newTo}.*Changed by Jonas Keller`) }),
  ).toBeVisible()
})

test("lead signs off last month for one person; that month is read-only", async ({ as }, info) => {
  const [leadKey, memberKey] = pick(info, ["jonas", "lea"] as const, ["elena", "tim"] as const)
  const member = PEOPLE[memberKey]
  const month = previousMonth()
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-15T12:00:00Z`),
  )

  const lead = await as(leadKey)
  await goto(lead, "/team/signoff")
  await expect(lead.getByText(monthName).first()).toBeVisible()
  const row = rows(lead).filter({ hasText: member.name })
  await expect(row).toContainText("Ready")
  await row.getByRole("checkbox", { name: `Select ${member.name}` }).check()
  await lead
    .getByRole("button", { name: /^Sign off/ })
    .first()
    .click()
  const confirm = lead.getByRole("alertdialog")
  await expect(confirm).toContainText(monthName)
  await confirm.getByRole("button", { name: "Sign off" }).click()
  await expect(toast(lead, `1 timesheet for ${monthName} signed off`)).toBeVisible()
  await expect(row).toContainText("Signed off")

  // the lead can no longer change the month
  await row.getByRole("link", { name: member.name }).click()
  await expect(lead.getByRole("heading", { level: 1, name: new RegExp(member.name) })).toBeVisible()
  const panel = lead.getByRole("tabpanel", { name: "Time" })
  await expect(panel.getByRole("button", { name: /^Add entry on/ })).toHaveCount(0)
  await panel
    .getByRole("button", { name: /^Work \d{2}:\d{2}/ })
    .first()
    .click()
  const dialog = lead.getByRole("dialog", { name: "Entry" })
  await expect(dialog).toContainText(/Signed off by .+ Read-only\./)
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Delete" })).toHaveCount(0)

  // and so can the employee
  const employee = await as(memberKey)
  await goto(employee, `/time?view=month&date=${month}-15`)
  await expect(employee.getByText(new RegExp(`${monthName} signed off by .+ Read-only\\.`))).toBeVisible()
  await rows(employee)
    .filter({ hasText: /^.*Work/ })
    .first()
    .click()
  const own = employee.getByRole("dialog", { name: "Entry" })
  await expect(own).toContainText(/Signed off by .+ Read-only\./)
  await expect(own.getByRole("button", { name: "Save" })).toHaveCount(0)
})
