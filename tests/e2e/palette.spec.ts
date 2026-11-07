import { expect, goto, PEOPLE, test } from "./fixtures"

test("command palette: Ctrl/⌘K finds a person and opens their page", async ({ as }) => {
  const page = await as("jonas")
  await goto(page, "/")
  const palette = page.getByRole("dialog", { name: "Search" })
  // the shortcut listener attaches after hydration, which can trail the first paint on a slow machine
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await palette.getByRole("combobox").fill("Lea")
  const hit = palette.getByRole("option", { name: new RegExp(PEOPLE.lea.name) })
  await expect(hit).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await hit.click()
  await expect(palette).toBeHidden()
  await expect(page).toHaveURL(/\/team\/member\/\d+/)
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(PEOPLE.lea.name) })).toBeVisible()

  // pages are found too, and Escape closes
  await page.keyboard.press("ControlOrMeta+k")
  await palette.getByRole("combobox").fill("approvals")
  await expect(palette.getByRole("option", { name: "Approvals" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(palette).toBeHidden()
})
