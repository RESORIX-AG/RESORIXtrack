import { expect, goto, isMobile, test } from "./fixtures"

test("notifications: opening one lowers the badge at once and after a reopen", async ({ as }, info) => {
  test.skip(isMobile(info), "one person's notifications; the bell is the same on phones")
  // only the demo's sign-off notification: no other test notifies Marc
  const page = await as("marc")
  await goto(page, "/")
  const bell = page.getByRole("button", { name: /^Notifications/ })
  const before = Number((await bell.getAttribute("aria-label"))?.match(/(\d+) unread/)?.[1] ?? 0)
  expect(before).toBeGreaterThan(0)
  const after = before > 1 ? `Notifications, ${before - 1} unread` : "Notifications"

  await bell.click()
  const popup = page.getByRole("dialog")
  await popup.getByRole("link").first().click()
  await expect(popup).toBeHidden()
  await expect(bell).toHaveAccessibleName(after)

  // the reopened list and a fresh bootstrap agree with the badge
  await bell.click()
  await expect(popup.getByRole("link").first()).toBeVisible()
  await expect(bell).toHaveAccessibleName(after)
  await page.keyboard.press("Escape")
  await goto(page, page.url())
  await expect(bell).toHaveAccessibleName(after)
})
