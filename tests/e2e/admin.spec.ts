import { expect, goto, pick, test, toast } from "./fixtures"

test("admin: create a person, change team and role", async ({ as }, info) => {
  const page = await as("admin")
  const stamp = `${pick(info, "d", "m")}${Date.now().toString(36)}`
  const name = `E2E Person ${stamp}`
  const email = `e2e.${stamp}@example.nomail`

  await goto(page, "/admin/users")
  await page.getByRole("button", { name: "Add employee" }).click()
  const sheet = page.getByRole("dialog", { name: "New employee" })
  await sheet.getByLabel("Name").fill(name)
  await sheet.getByLabel("Email").fill(email)
  await sheet.getByRole("button", { name: "Invite" }).click()
  // no mail server in this setup: the person is created, the invitation stays queued or is reported unsent
  await expect(toast(page, new RegExp(`Invitation sent to ${email}|Added, invitation not sent`))).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
  await expect(page.getByText("Invited", { exact: true }).first()).toBeVisible()

  await page.getByRole("combobox", { name: "Team" }).click()
  await page.getByRole("option", { name: "Operations" }).click()
  await page.getByRole("combobox", { name: "Role" }).click()
  await page.getByRole("option", { name: "Admin" }).click()
  await page.getByRole("button", { name: "Save" }).click()
  // the team is a dated term: the save asks from which day it applies (empty: today)
  const when = page.getByRole("dialog", { name: "When do the changes apply?" })
  await expect(when.getByRole("button", { name: "Changes apply from" })).toHaveText("Today")
  await when.getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Saved")).toBeVisible()
  await expect(when).toBeHidden()

  await page.reload()
  await expect(page.getByRole("combobox", { name: "Team" })).toHaveText("Operations")
  await expect(page.getByRole("combobox", { name: "Role" })).toHaveText("Admin")

  await goto(page, "/admin/users")
  await page.getByRole("searchbox", { name: "Search name or email" }).fill(stamp)
  await expect(page.getByRole("row").or(page.getByRole("listitem")).filter({ hasText: name })).toContainText(
    "Operations",
  )
})

test("admin: holiday import dialog opens", async ({ as }) => {
  const page = await as("admin")
  await goto(page, "/admin/holidays")
  await page.getByRole("button", { name: "Import" }).click()
  const dialog = page.getByRole("dialog", { name: "Import public holidays" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
})

test("admin: create sheets open without a record", async ({ as }) => {
  const page = await as("admin")
  await goto(page, "/admin/holidays")
  await page.getByRole("button", { name: "New calendar" }).first().click()
  const calendar = page.getByRole("dialog", { name: "New calendar" })
  await expect(calendar.getByLabel("Name")).toBeVisible()
  await calendar.getByRole("button", { name: "Cancel" }).click()
  await expect(calendar).toBeHidden()

  await goto(page, "/admin/settings?tab=types")
  await page.getByRole("button", { name: "New type" }).click()
  const type = page.getByRole("dialog", { name: "New type" })
  await expect(type.getByLabel("Label")).toBeVisible()
})

test("admin: delete a calendar", async ({ as }, info) => {
  const page = await as("admin")
  const name = `E2E Calendar ${pick(info, "d", "m")}${Date.now().toString(36)}`
  await goto(page, "/admin/holidays")
  await page.getByRole("button", { name: "New calendar" }).first().click()
  const create = page.getByRole("dialog", { name: "New calendar" })
  await create.getByLabel("Name").fill(name)
  await create.getByRole("button", { name: "Create" }).click()
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible()

  await page.getByRole("button", { name: "Edit calendar" }).click()
  await page.getByRole("dialog", { name: "Edit calendar" }).getByRole("button", { name: "Delete" }).click()
  const confirm = page.getByRole("alertdialog", { name: `Delete ${name}?` })
  await confirm.getByRole("button", { name: "Delete" }).click()
  await expect(toast(page, "Calendar deleted")).toBeVisible()
  await expect(confirm).toBeHidden()
  await expect(page.getByText(name)).toHaveCount(0)
})

test("admin: settings save a switch", async ({ as }, info) => {
  const page = await as("admin")
  // each project toggles its own setting (they run in parallel against one database)
  const label = pick(info, "Leads edit schedules", "Leads adjust balances")
  await goto(page, "/admin/settings")
  await page.getByRole("tab", { name: "Working time" }).click()
  const panel = page.getByRole("tabpanel", { name: "Working time" })
  const toggle = panel.getByRole("switch", { name: label })
  const before = (await toggle.getAttribute("aria-checked")) === "true"
  const unsaved = panel.getByText("Unsaved changes")
  const discard = panel.getByRole("button", { name: "Discard" })

  // reverting by hand clears the unsaved state
  await toggle.click()
  await expect(unsaved).toBeVisible()
  await toggle.click()
  await expect(unsaved).toBeHidden()
  await expect(discard).toBeHidden()

  await toggle.click()
  await panel.getByRole("button", { name: "Save" }).click()
  await expect(unsaved).toBeHidden()
  await expect(toast(page, "Saved")).toBeVisible()
  await page.reload()
  await page.getByRole("tab", { name: "Working time" }).click()
  await expect(toggle).toHaveAttribute("aria-checked", String(!before))

  // and back
  await toggle.click()
  await panel.getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Saved")).toBeVisible()
  await page.reload()
  await page.getByRole("tab", { name: "Working time" }).click()
  await expect(toggle).toHaveAttribute("aria-checked", String(before))
})
