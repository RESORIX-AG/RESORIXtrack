/**
 * Screenshots for README.md and docs/ from a freshly seeded throwaway production instance.
 *   pnpm screenshots                    (build + seed + start + capture into docs/screenshots)
 *   SHOT_SKIP_BUILD=1 pnpm screenshots  (reuse dist/)
 * Seed, server and browser run on a shifted clock (scripts/shift-clock.mjs): the most recent Thursday, 10:42 in
 * Zurich, so the pictures show a working morning with a running clock whenever they are taken.
 */
import { spawn } from "node:child_process"
import { mkdirSync, readdirSync, utimesSync } from "node:fs"
import path from "node:path"
import { type Browser, chromium, type Page } from "@playwright/test"
import Database from "better-sqlite3"

const root = path.resolve(import.meta.dirname, "..")
const out = path.join(root, "docs/screenshots")
const dataDir = path.join(root, "var/screenshots")
const port = process.env.SHOT_PORT ?? "3240"
const base = `http://127.0.0.1:${port}`

type Theme = "dark" | "light"
type Shot = {
  file: string
  path: string
  email?: string
  theme: Theme
  mobile?: boolean
  /** runs once the page has settled; the page is reloaded afterwards */
  prepare?: (page: Page) => Promise<void>
}

const shotTime = (() => {
  const today = Temporal.Now.plainDateISO("Europe/Zurich")
  const thursday = today.subtract({ days: (today.dayOfWeek - 4 + 7) % 7 })
  return thursday.toZonedDateTime({ timeZone: "Europe/Zurich", plainTime: "10:42" }).toInstant()
})()
const clockOffset = shotTime.epochMilliseconds - Date.now()

// Tim is the demo employee who is clocked in
const employee = "tim.baumann@example.nomail"
// lead of Operations, Tim's team, so the team overview shows someone at work
const lead = "elena.kovac@example.nomail"
const admin = "admin@example.nomail"

const SHOTS: Shot[] = [
  { file: "login-dark", path: "/login", theme: "dark" },
  { file: "login-light", path: "/login", theme: "light" },
  { file: "employee-dark-home", path: "/", email: employee, theme: "dark" },
  { file: "employee-dark-time", path: "/time", email: employee, theme: "dark" },
  { file: "employee-dark-time_view_month", path: "/time?view=month", email: employee, theme: "dark" },
  { file: "employee-dark-absences", path: "/absences", email: employee, theme: "dark" },
  { file: "employee-dark-account", path: "/account", email: employee, theme: "dark" },
  { file: "employee-dark-profile", path: "/profile", email: employee, theme: "dark" },
  { file: "employee-light-home", path: "/", email: employee, theme: "light" },
  { file: "employee-light-time", path: "/time", email: employee, theme: "light" },
  { file: "employee-light-absences", path: "/absences", email: employee, theme: "light" },
  { file: "lead-dark-team", path: "/team", email: lead, theme: "dark" },
  { file: "lead-dark-team_approvals", path: "/team/approvals", email: lead, theme: "dark" },
  { file: "lead-dark-team_signoff", path: "/team/signoff", email: lead, theme: "dark" },
  { file: "lead-dark-reports", path: "/reports", email: lead, theme: "dark" },
  { file: "admin-dark-admin_users", path: "/admin/users", email: admin, theme: "dark" },
  { file: "admin-dark-admin_teams", path: "/admin/teams", email: admin, theme: "dark" },
  { file: "admin-dark-admin_holidays", path: "/admin/holidays", email: admin, theme: "dark" },
  { file: "admin-dark-admin_settings", path: "/admin/settings", email: admin, theme: "dark" },
  {
    file: "admin-dark-admin_backups",
    path: "/admin/backups",
    email: admin,
    theme: "dark",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Create backup" }).click()
      await page
        .getByRole("cell", { name: /\.enc$/ })
        .first()
        .waitFor()
      // the list shows the file time, which the preload cannot shift
      const at = new Date(shotTime.epochMilliseconds)
      for (const name of readdirSync(path.join(dataDir, "backups")))
        utimesSync(path.join(dataDir, "backups", name), at, at)
    },
  },
  { file: "mobile-dashboard", path: "/", email: employee, theme: "dark", mobile: true },
]

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${base}/api/health`)).ok
  } catch {
    return false
  }
}

async function waitForServer(server: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("the instance exited before it was ready")
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling: each probe waits for the previous one
    if (await healthy()) return
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling interval
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("the instance did not start")
}

/**
 * Column defaults are filled by SQLite's own clock, which the preload cannot shift: give the pending requests
 * plausible times before the shifted "now" instead of the real one.
 */
function backdateRequests() {
  const db = new Database(path.join(dataDir, "resorixtrack.db"))
  try {
    const ids = db.prepare("select id from absences where status = 'pending' order by id").pluck().all()
    const update = db.prepare("update absences set created_at = ? where id = ?")
    const zurich = shotTime.toZonedDateTimeISO("Europe/Zurich")
    const signedIn = db.prepare("update users set last_login_at = ? where id = ?")
    db.prepare("select id from users where last_login_at is null order by id")
      .pluck()
      .all()
      .forEach((id, i) => {
        const at = zurich.subtract({ days: i % 3 }).with({ hour: 7 + (i % 3), minute: (i * 13) % 60 })
        signedIn.run(at.toInstant().toString({ smallestUnit: "microsecond" }), id)
      })
    ids.forEach((id, i) => {
      const at = zurich
        .subtract({ days: 1 + i * 2 })
        .with({ hour: 9 + ((i * 3) % 8), minute: (i * 23) % 60 })
        .toInstant()
      update.run(at.toString({ smallestUnit: "microsecond" }), id)
    })
  } finally {
    db.close()
  }
}

async function signIn(page: Page, email: string) {
  await page.goto(`${base}/login`)
  await settled(page)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("demo")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"))
}

/** Hydrated, data loaded, no skeletons, fonts ready, no toasts or focus rings in the picture. */
async function settled(page: Page) {
  await page.waitForFunction(() => Object.keys(document.body).some((k) => k.startsWith("__reactFiber")))
  await page.waitForLoadState("networkidle")
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="skeleton"]').length === 0)
  await page.evaluate(() => document.fonts.ready)
}

async function capture(browser: Browser, shot: Shot) {
  const viewport = shot.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: shot.mobile ?? false,
    hasTouch: shot.mobile ?? false,
    locale: "en-GB",
    timezoneId: "Europe/Zurich",
    colorScheme: shot.theme,
    reducedMotion: "reduce",
  })
  await context.clock.install({ time: Date.now() + clockOffset })
  await context.addCookies([{ name: "rt_theme", value: shot.theme, url: base }])
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  if (shot.email) await signIn(page, shot.email)
  await page.goto(`${base}${shot.path}`)
  await settled(page)
  if (shot.prepare) {
    await shot.prepare(page)
    await page.reload()
    await settled(page)
  }
  await page.addStyleTag({
    content: "[data-sonner-toaster] { display: none !important; } * { caret-color: transparent; }",
  })
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.mouse.move(0, viewport.height - 1)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, `${shot.file}.png`) })
  await context.close()
  if (errors.length) throw new Error(`${shot.file}: ${errors.join("; ")}`)
  console.log(`saved docs/screenshots/${shot.file}.png`)
}

async function main() {
  if (await healthy()) throw new Error(`something already listens on :${port}; stop it or set SHOT_PORT`)
  mkdirSync(out, { recursive: true })
  const server = spawn("pnpm", ["exec", "tsx", "scripts/e2e-server.ts"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      E2E_PORT: port,
      E2E_DATA_DIR: dataDir,
      NODE_OPTIONS: `--import ${path.join(root, "scripts/shift-clock.mjs")}`,
      SHIFT_CLOCK_TO: shotTime.toString(),
      ...(process.env.SHOT_SKIP_BUILD ? { E2E_SKIP_BUILD: "1" } : {}),
    },
  })
  // shown only when the instance fails to start; afterwards it is noise from closed browser connections
  let log = ""
  server.stderr?.on("data", (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-20_000)
  })
  const stop = () => {
    if (server.pid && server.exitCode === null) process.kill(-server.pid, "SIGTERM")
  }
  process.on("SIGINT", stop)
  try {
    await waitForServer(server).catch((err: unknown) => {
      process.stderr.write(log)
      throw err
    })
    backdateRequests()
    const browser = await chromium.launch()
    try {
      // one at a time: parallel sign-ins would trip the login rate limit and the shots share one database
      for (const shot of SHOTS) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose, see above
        await capture(browser, shot)
      }
    } finally {
      await browser.close()
    }
  } finally {
    stop()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
