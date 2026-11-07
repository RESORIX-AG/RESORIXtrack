import type { Page } from "@playwright/test"
import { expect, goto, pick, test } from "./fixtures"

test("profile: German UI after changing the language", async ({ as }, info) => {
  // people nobody else uses in the suite: the language is stored in the profile
  const page = await as(pick(info, "luca", "tim"))
  await goto(page, "/profile")
  await page.getByRole("combobox", { name: "Language" }).click()
  await page.getByRole("option", { name: "Deutsch" }).click()
  await page.getByRole("button", { name: "Save" }).first().click()

  await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "de")
  await page.reload()
  await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible()
  await goto(page, "/time")
  await expect(page.getByRole("heading", { level: 1, name: "Meine Zeit" })).toBeVisible()

  // back to English
  await goto(page, "/profile")
  await page.getByRole("combobox", { name: "Sprache" }).click()
  await page.getByRole("option", { name: "English" }).click()
  await page.getByRole("button", { name: "Speichern" }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
})

test("theme: System, Light and Dark persist after reload", async ({ as }) => {
  const page = await as("mia")
  await page.emulateMedia({ colorScheme: "dark" })
  await goto(page, "/")
  const html = page.locator("html")
  const choose = async (from: string, to: string) => {
    await page.getByRole("button", { name: `Theme: ${from}` }).click()
    await page.getByRole("menuitemradio", { name: to }).click()
  }
  await expect(html).not.toHaveClass(/\b(light|dark)\b/)

  await choose("System", "Light")
  await expect(html).toHaveClass(/\blight\b/)
  await expect.poll(() => scheme(page)).toBe("light")
  await page.reload()
  await expect(html).toHaveClass(/\blight\b/)

  await choose("Light", "Dark")
  await expect(html).toHaveClass(/\bdark\b/)
  await expect(html).not.toHaveClass(/\blight\b/)
  await page.reload()
  await expect(html).toHaveClass(/\bdark\b/)
  await page.emulateMedia({ colorScheme: "light" })
  await expect.poll(() => scheme(page)).toBe("dark")

  await choose("Dark", "System")
  await expect(html).not.toHaveClass(/\b(light|dark)\b/)
  await expect.poll(() => scheme(page)).toBe("light")
  await page.reload()
  await expect(html).not.toHaveClass(/\b(light|dark)\b/)
  await expect(page.getByRole("button", { name: "Theme: System" })).toBeVisible()
})

for (const device of ["light", "dark"] as const) {
  test(`theme: System follows a ${device} device, also while the page is open`, async ({ as }) => {
    const page = await as("lea")
    await page.emulateMedia({ colorScheme: device })
    await goto(page, "/")
    await expect.poll(() => scheme(page)).toBe(device)
    const other = device === "light" ? "dark" : "light"
    await page.emulateMedia({ colorScheme: other })
    await expect.poll(() => scheme(page)).toBe(other)
  })
}

/** The effective theme as CSS sees it. */
function scheme(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
}

test("api keys: a created key is listed without a reload", async ({ as }, info) => {
  // English-UI people the language test above never touches (it switches luca to German meanwhile)
  const page = await as(pick(info, "elena", "mia"))
  await goto(page, "/profile")
  await page.getByRole("button", { name: "New key" }).click()
  const dialog = page.getByRole("dialog", { name: "New key" })
  const name = `E2E key ${Date.now()}`
  await dialog.getByLabel("Name").fill(name)
  await dialog.getByLabel("Your password").fill("demo")
  await dialog.getByRole("button", { name: "Create key" }).click()
  const created = page.getByRole("dialog", { name: "Key created" })
  await expect(created).toBeVisible()
  await created.getByRole("button", { name: "Close" }).last().click() // the footer button, not the X
  await expect(created).toBeHidden()
  await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible() // listed without a reload
})
