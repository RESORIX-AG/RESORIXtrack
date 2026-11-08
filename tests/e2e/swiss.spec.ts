import { expect, goto, test } from "./fixtures"

test("Italian UI renders", async ({ browser }) => {
  const context = await browser.newContext({ locale: "it-CH" })
  const page = await context.newPage()
  await goto(page, "/login")
  await expect(page.locator("html")).toHaveAttribute("lang", "it")
  await expect(page.getByRole("heading", { level: 1, name: "Accedi" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Password dimenticata?" })).toBeVisible()
  await context.close()
})

test("admin sees the holiday top-up notification", async ({ as }) => {
  const page = await as("admin")
  await goto(page, "/")
  await page.getByRole("button", { name: /^Notifications/ }).click()
  const next = new Date().getFullYear() + 1
  const note = page.getByRole("link", {
    name: new RegExp(`Public holidays ${next} added to Kanton Zürich \\(\\d+ days\\)`),
  })
  await expect(note).toBeVisible()
  await note.click()
  await expect(page).toHaveURL(new RegExp(`/admin/holidays\\?cal=\\d+&year=${next}`))
  await expect(page.getByRole("heading", { level: 2, name: /Kanton Zürich/ })).toBeVisible()
})
