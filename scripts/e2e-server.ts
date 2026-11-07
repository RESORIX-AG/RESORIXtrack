/**
 * Server for the Playwright suite: fresh throwaway data dir, demo company, production build on E2E_PORT.
 *   pnpm exec tsx scripts/e2e-server.ts            (build + seed + start)
 *   E2E_SKIP_BUILD=1 pnpm exec tsx scripts/e2e-server.ts   (reuse dist/ while iterating)
 */
import { type SpawnOptions, spawn } from "node:child_process"
import { rmSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"

const root = path.resolve(import.meta.dirname, "..")
const port = process.env.E2E_PORT ?? "3230"
const dataDir = path.resolve(root, process.env.E2E_DATA_DIR ?? "var/e2e")

const secrets = {
  SECRET_KEY: "e2e-secret-key-8f3a9c1d7b2e4f60a5c9d8e7f6b1a2c3",
  BACKUP_PASSWORD: "e2e-backup-passphrase",
}
const base = { ...process.env, ...secrets, RESORIXTRACK_DATA_DIR: dataDir }

function run(cmd: string, args: string[], opts: SpawnOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", ...opts })
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))))
  })
}

async function main() {
  rmSync(dataDir, { recursive: true, force: true })
  // seed-demo refuses to run in production, so the data is seeded in development mode with the same secrets
  await run("pnpm", ["exec", "tsx", "src/cli/index.ts", "seed-demo", "--reset"], {
    env: { ...base, NODE_ENV: "development" },
    stdio: ["ignore", "ignore", "inherit"],
  })
  // one UI language for every demo person keeps the assertions simple; the locale test switches explicitly
  const sqlite = new Database(path.join(dataDir, "resorixtrack.db"))
  sqlite.prepare("update users set locale = 'en'").run()
  sqlite.close()
  // a preset calendar with this year only: the top-up adds next year and notifies the administrators
  const cli = (...args: string[]) =>
    run("pnpm", ["exec", "tsx", "src/cli/index.ts", ...args], {
      env: { ...base, NODE_ENV: "development" },
      stdio: ["ignore", "ignore", "inherit"],
    })
  await cli("install-holidays", "--preset", "CH-ZH", "--years", String(new Date().getFullYear()))
  await cli("install-holidays", "--top-up")
  if (!process.env.E2E_SKIP_BUILD) await run("pnpm", ["build"], { env: { ...base, NODE_ENV: "production" } })

  const server = spawn("node", ["server.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...base,
      NODE_ENV: "production",
      PORT: port,
      HOST: "127.0.0.1",
      BASE_URL: `http://127.0.0.1:${port}`, // same host the browser uses (origin check)
      SESSION_COOKIE_SECURE: "false",
      PWNED_PASSWORDS_CHECK: "false",
      TRUSTED_PROXIES: "0",
      // generous limit: every role signs in from the same address several times per run
      LOGIN_MAX_FAILURES: "50",
    },
  })
  const stop = () => server.kill("SIGTERM")
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  server.on("exit", (code) => process.exit(code ?? 0))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
