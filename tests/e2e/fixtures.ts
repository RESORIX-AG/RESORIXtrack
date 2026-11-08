import { mkdirSync } from "node:fs"
import path from "node:path"
import {
  type Browser,
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test"

export { expect }

export const PASSWORD = "demo"
export const AUTH_DIR = path.resolve(import.meta.dirname, "../../var/e2e-auth")
mkdirSync(AUTH_DIR, { recursive: true })

/** Demo people (scripts/e2e-server.ts switches everybody to English). */
export const PEOPLE = {
  admin: { email: "admin@example.nomail", name: "RESORIXtrack Admin" },
  nina: { email: "nina.graf@example.nomail", name: "Nina Graf" }, // HR, Operations
  luca: { email: "luca.bianchi@example.nomail", name: "Luca Bianchi" }, // lead RF Engineering
  anna: { email: "anna.meier@example.nomail", name: "Anna Meier" }, // RF Engineering
  marc: { email: "marc.dubois@example.nomail", name: "Marc Dubois" }, // RF Engineering, 80 %
  sofia: { email: "sofia.rossi@example.nomail", name: "Sofia Rossi" }, // RF Engineering, deputy lead
  jonas: { email: "jonas.keller@example.nomail", name: "Jonas Keller" }, // lead Software & DSP
  lea: { email: "lea.schneider@example.nomail", name: "Lea Schneider" }, // Software & DSP
  noah: { email: "noah.favre@example.nomail", name: "Noah Favre" }, // Software & DSP, 60 %
  mia: { email: "mia.brunner@example.nomail", name: "Mia Brunner" }, // Software & DSP
  elena: { email: "elena.kovac@example.nomail", name: "Elena Kovac" }, // lead Operations
  tim: { email: "tim.baumann@example.nomail", name: "Tim Baumann" }, // Operations, clocked in
} as const
export type Who = keyof typeof PEOPLE
export const EVERYONE: Who[] = [
  "admin",
  "nina",
  "luca",
  "anna",
  "marc",
  "sofia",
  "jonas",
  "lea",
  "noah",
  "mia",
  "elena",
  "tim",
]

export const statePath = (who: Who) => path.join(AUTH_DIR, `${who}.json`)

export const isMobile = (info: TestInfo) => info.project.name === "mobile"

/**
 * Both projects run in parallel against one database, so tests that change data pick their people per
 * project: `pick(info, desktopPerson, mobilePerson)`.
 */
export const pick = <T>(info: TestInfo, desktop: T, mobile: T): T => (isMobile(info) ? mobile : desktop)

/** React has hydrated the document and run its effects (event handlers and window shortcuts are attached). */
export async function hydrated(page: Page) {
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" })
}

export async function goto(page: Page, url: string) {
  await page.goto(url)
  await hydrated(page)
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await goto(page, "/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

/** Local calendar day (Europe/Zurich, the demo time zone) as YYYY-MM-DD, offset by `days`. */
export function zurichDay(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(d)
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** 0 = Monday … 6 = Sunday */
export function weekday(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
}
/** Most recent day before today with the given weekday (0 = Monday). */
export function lastWeekday(wd: number, today = zurichDay()): string {
  let d = addDays(today, -1)
  while (weekday(d) !== wd) d = addDays(d, -1)
  return d
}
export function previousMonth(today = zurichDay()): string {
  return addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
}

type Fixtures = {
  /** A signed-in page for a demo person (storage state from auth.setup.ts); contexts close after the test. */
  as: (who: Who) => Promise<Page>
}

async function contextFor(browser: Browser, who: Who, contexts: BrowserContext[]) {
  const ctx = await browser.newContext({ storageState: statePath(who) })
  contexts.push(ctx)
  return ctx
}

export const test = base.extend<Fixtures>({
  as: async ({ browser }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (who) => {
      const ctx = await contextFor(browser, who, contexts)
      return ctx.newPage()
    })
    await Promise.all(contexts.map((ctx) => ctx.close()))
  },
})

/** A data-table row: a table row on desktop, a list item on phones (role queries skip the hidden variant). */
export function rows(page: Page) {
  return page.getByRole("row").or(page.getByRole("listitem"))
}

/** "May 2027" for a YYYY-MM-DD day, as the app prints it next to dates. */
export function monthYear(day: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  )
}

/** A toast message (sonner's live region). */
export function toast(page: Page, text: string | RegExp) {
  return page.getByRole("region", { name: /^Notifications/ }).getByText(text)
}

/** Every main page, with the person who can open it (null: signed out). */
export const PAGES: [Who | null, string][] = [
  [null, "/login"],
  [null, "/forgot"],
  [null, "/privacy"],
  ["mia", "/"],
  ["mia", "/time"],
  ["mia", "/absences"],
  ["mia", "/account"],
  ["mia", "/holidays"],
  ["mia", "/reports"],
  ["mia", "/calendar"],
  ["mia", "/profile"],
  ["jonas", "/team"],
  ["jonas", "/team/approvals"],
  ["jonas", "/team/signoff"],
  ["nina", "/team/projects"],
  ["admin", "/admin/users"],
  ["admin", "/admin/teams"],
  ["admin", "/admin/holidays"],
  ["admin", "/admin/settings"],
  ["admin", "/admin/backups"],
]

/** Picks a day in a date picker (the trigger is the labelled control): opens it and steps to the month. */
export async function pickDate(trigger: Locator, iso: string) {
  await trigger.click()
  const calendar = trigger.page().locator("[data-slot=popover-content] [data-slot=calendar]").last()
  await expect(calendar).toBeVisible()
  const inMonth = calendar.locator("td:not([data-outside]) button[data-iso]")
  for (let step = 0; step < 60; step++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step depends on the month shown
    const shown = (await inMonth.first().getAttribute("data-iso"))?.slice(0, 7) ?? ""
    if (shown === iso.slice(0, 7)) break
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above
    await calendar.locator(shown < iso.slice(0, 7) ? ".rdp-button_next" : ".rdp-button_previous").click()
  }
  await calendar.locator(`td:not([data-outside]) button[data-iso="${iso}"]`).click()
  await expect(calendar).toBeHidden()
}
