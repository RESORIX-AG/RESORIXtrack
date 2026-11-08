import type { Page, TestInfo } from "@playwright/test"
import { expect, goto, isMobile, pick, rows, test } from "./fixtures"

/** Opens a page through the navigation (the "More" sheet on phones). */
async function navigateTo(page: Page, info: TestInfo, name: string) {
  if (isMobile(info)) await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("link", { name, exact: true }).click()
}

test("employee: public holidays page is read-only and shows the applicable calendar", async ({ as }, info) => {
  const page = await as("mia")
  await goto(page, "/")
  await navigateTo(page, info, "Public holidays")
  await expect(page).toHaveURL(/\/holidays$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Public holidays")
  // the demo company's default calendar applies to everyone
  await expect(page.getByRole("heading", { level: 2, name: "Kanton Freiburg" })).toBeVisible()
  await expect(page.getByText("company default")).toBeVisible()
  const year = String(new Date().getFullYear())
  await expect(page.getByRole("tab", { name: year })).toHaveAttribute("aria-selected", "true")
  await expect(rows(page).filter({ hasText: "Swiss National Day" })).toHaveCount(1)
  await expect(rows(page).filter({ hasText: "Christmas Day" })).toContainText("Full day")
  // read-only: nothing to import, add, edit or delete; no link to the administration for employees
  await expect(page.getByRole("button", { name: /import|add holiday|edit|delete/i })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Manage calendars" })).toHaveCount(0)
  // next year is a tab too and keeps the page in place
  await page.getByRole("tab", { name: String(Number(year) + 1) }).click()
  await expect(page).toHaveURL(new RegExp(`year=${Number(year) + 1}`))
  await expect(rows(page).filter({ hasText: "Swiss National Day" })).toHaveCount(1)
})

test("admin: the menu says Holiday calendars and Public holidays links to the administration", async ({ as }, info) => {
  const page = await as("admin")
  await goto(page, "/")
  await navigateTo(page, info, "Holiday calendars")
  await expect(page).toHaveURL(/\/admin\/holidays$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Holiday calendars")
  await goto(page, "/holidays")
  await page.getByRole("link", { name: "Manage calendars" }).click()
  await expect(page).toHaveURL(/\/admin\/holidays$/)
})

test("admin: a canton calendar with an optional day, ticked on create and unticked later", async ({ as }, info) => {
  const page = await as("admin")
  // each project its own canton: they run in parallel against one database
  const canton = pick(info, { code: "LU", name: "Canton of Lucerne" }, { code: "ZG", name: "Canton of Zug" })
  const next = new Date().getFullYear() + 1
  await goto(page, "/admin/holidays")
  await page.getByRole("button", { name: "New calendar" }).first().click()
  const sheet = page.getByRole("dialog", { name: "New calendar" })
  if (isMobile(info)) {
    await sheet.getByRole("combobox", { name: "Canton" }).click()
    await page.getByRole("option", { name: canton.name }).click()
  } else {
    // the map is a pointer shortcut next to the list
    await sheet.locator(`[data-canton="${canton.code}"]`).click()
    await expect(sheet.getByRole("combobox", { name: "Canton" })).toContainText(canton.name)
  }
  // the name follows the canton until typed by hand
  await expect(sheet.getByLabel("Name")).toHaveValue(canton.name)
  const name = `${canton.name} E2E`
  await sheet.getByLabel("Name").fill(name)
  const easterMonday = sheet.getByRole("checkbox", { name: /Easter Monday/ })
  await expect(easterMonday).not.toBeChecked()
  await easterMonday.check()
  await sheet.getByRole("switch", { name: "Company default" }).uncheck()
  await sheet.getByRole("button", { name: "Create" }).click()
  const heading = page.getByRole("heading", { level: 2, name })
  await expect(heading).toBeVisible()

  const id = new URL(page.url()).searchParams.get("cal")
  await goto(page, `/admin/holidays?cal=${id}&year=${next}`)
  await expect(rows(page).filter({ hasText: "Easter Monday" })).toHaveCount(1)
  await expect(rows(page).filter({ hasText: "Whit Monday" })).toHaveCount(0)

  await page.getByRole("button", { name: "Edit calendar" }).click()
  const edit = page.getByRole("dialog", { name: "Edit calendar" })
  await edit.getByRole("checkbox", { name: /Easter Monday/ }).uncheck()
  await edit.getByRole("button", { name: "Save" }).click()
  await expect(edit).toBeHidden()
  await goto(page, `/admin/holidays?cal=${id}&year=${next}`)
  await expect(rows(page).filter({ hasText: "Christmas Day" })).toHaveCount(1)
  await expect(rows(page).filter({ hasText: "Easter Monday" })).toHaveCount(0)
})
