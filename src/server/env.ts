import "@tanstack/react-start/server-only"
/**
 * Environment-driven configuration (12-factor). Secrets can also be read from `<NAME>_FILE`
 * (Docker/Compose secrets). Server-only: never import this from client code.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

const NODE_ENV = process.env.NODE_ENV ?? "development"
export const isProd = NODE_ENV === "production"
export const isTest = NODE_ENV === "test" || process.env.VITEST === "true"
export const isDev = !isProd && !isTest

function secret(name: string, devDefault = ""): string {
  const file = process.env[`${name}_FILE`]
  if (file) return readFileSync(file, "utf8").trim()
  return process.env[name] ?? (isProd ? "" : devDefault)
}
function bool(name: string, def: boolean): boolean {
  const v = process.env[name]
  return v == null ? def : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase())
}
function oneOf<const T extends string>(name: string, values: readonly T[], def: T): T {
  const v = (process.env[name] ?? def).toLowerCase()
  const match = values.find((allowed) => allowed === v)
  if (match === undefined) throw new Error(`${name} must be one of ${values.join(", ")} (got "${v}")`)
  return match
}
function int(name: string, def: number, min = 0): number {
  const v = process.env[name]
  if (v == null || v === "") return def
  const n = Number(v)
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min} (got "${v}")`)
  return n
}

const dataDir = path.resolve(process.env.RESORIXTRACK_DATA_DIR ?? (isProd ? "/data" : "./var"))

export const env = {
  nodeEnv: NODE_ENV,
  dataDir,
  databasePath: process.env.DATABASE_PATH ?? (isTest ? ":memory:" : path.join(dataDir, "resorixtrack.db")),
  attachmentsDir: path.join(dataDir, "attachments"),
  brandingDir: path.join(dataDir, "branding"),
  backupsDir: path.join(dataDir, "backups"),

  secretKey: secret("SECRET_KEY", "dev-insecure-secret-key-change-me-0123456789"),
  /** Key for sealing month sign-offs; defaults to SECRET_KEY (as in v1). */
  signoffKey: secret("SIGNOFF_KEY") || secret("SECRET_KEY", "dev-insecure-secret-key-change-me-0123456789"),
  backupPassword: secret("BACKUP_PASSWORD", "dev-backup-password"),
  baseUrl: (process.env.BASE_URL ?? (isProd ? "http://localhost:8080" : "http://localhost:3210")).replace(/\/$/, ""),
  sourceUrl: process.env.SOURCE_URL ?? "https://github.com/RESORIX-AG/RESORIXtrack",

  cookieSecure: bool("SESSION_COOKIE_SECURE", isProd),
  sessionRememberDays: int("SESSION_REMEMBER_DAYS", 30),
  sessionShortIdleHours: int("SESSION_SHORT_IDLE_HOURS", 12),
  sessionAbsoluteDays: int("SESSION_ABSOLUTE_DAYS", 90),
  setupCodeRequired: bool("SETUP_CODE_REQUIRED", isProd),
  pwnedCheck: bool("PWNED_PASSWORDS_CHECK", isProd),
  loginMaxFailures: int("LOGIN_MAX_FAILURES", isTest ? 5 : 8),
  loginWindowMinutes: int("LOGIN_WINDOW_MINUTES", 15),
  trustedProxies: int("TRUSTED_PROXIES", 0),

  smtp: {
    host: process.env.SMTP_HOST ?? (isDev ? "localhost" : ""),
    port: int("SMTP_PORT", isDev ? 1025 : 587),
    user: process.env.SMTP_USER ?? "",
    password: secret("SMTP_PASSWORD"),
    security: oneOf("SMTP_SECURITY", ["starttls", "ssl", "none"], isDev ? "none" : "starttls"),
    allowPlaintextAuth: bool("SMTP_ALLOW_PLAINTEXT_AUTH", false),
    timeoutSeconds: int("SMTP_TIMEOUT", 20),
    from: process.env.MAIL_FROM ?? "RESORIXtrack <resorixtrack@localhost>",
  },

  /** Single sign-on via OpenID Connect (e.g. Pocket ID). Active when issuer and client id are set. */
  oidc: {
    issuer: (process.env.OIDC_ISSUER ?? "").replace(/\/$/, ""),
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: secret("OIDC_CLIENT_SECRET"),
    name: process.env.OIDC_NAME || "Pocket ID",
    scopes: (process.env.OIDC_SCOPES || "openid email profile").split(/[\s,]+/).filter(Boolean),
    only: bool("OIDC_ONLY", false),
    requireVerifiedEmail: bool("OIDC_REQUIRE_VERIFIED_EMAIL", true),
  },

  attachmentMaxMb: int("ATTACHMENT_MAX_MB", 10),
  backupKeep: int("BACKUP_KEEP", 14, 1),
}

const PLACEHOLDER = "change-me-to-a-long-random-string-of-at-least-32-characters"

/** Refuse to start production with missing or weak secrets. Called by the auth module, the CLI and the worker. */
export function assertProductionConfig(): void {
  if (!isProd) return
  const problems: string[] = []
  if (
    !env.secretKey ||
    env.secretKey === PLACEHOLDER ||
    env.secretKey.startsWith("change-me") ||
    env.secretKey.length < 32 ||
    new Set(env.secretKey).size < 10
  )
    problems.push("SECRET_KEY must be set to a random string of at least 32 characters")
  if (!env.backupPassword || env.backupPassword.length < 12 || env.backupPassword.startsWith("change-me"))
    problems.push("BACKUP_PASSWORD must be set (at least 12 characters)")
  if (problems.length) {
    throw new Error(`RESORIXtrack refuses to start:\n - ${problems.join("\n - ")}`)
  }
}
