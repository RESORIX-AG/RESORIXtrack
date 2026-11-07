import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.E2E_PORT ?? 3230)
// 127.0.0.1, not localhost: CI runners resolve localhost to ::1 first, where nothing listens
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "Europe/Zurich",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      // response headers do not depend on the device
      testIgnore: /csp\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: "pnpm exec tsx scripts/e2e-server.ts",
    url: `${baseURL}/api/health`,
    // the suite expects freshly seeded data; E2E_REUSE=1 keeps a server you started yourself
    reuseExistingServer: Boolean(process.env.E2E_REUSE),
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { E2E_PORT: String(port) },
  },
})
