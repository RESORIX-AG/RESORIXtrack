/**
 * Global request middleware: per-request CSP nonce + security headers, and CSRF protection for every
 * state-changing request (server functions, Better Auth). The REST API (/api/v1) authenticates with API
 * keys only, never cookies, so it is exempt from the browser origin check.
 */
import { createSerializationAdapter } from "@tanstack/react-router"
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"
import { getRequest, setResponseHeader } from "@tanstack/react-start/server"
import { isRecord } from "@/lib/guards"
import { AppError } from "@/server/errors"

const isProd = process.env.NODE_ENV === "production"

const securityHeaders = createMiddleware({ type: "request" }).server(async ({ next }) => {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
  const result = await next({ context: { nonce } })
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
  // Vite's dev server injects inline scripts without a nonce, so the strict policy is production-only.
  // Routes serving files (logos, attachments) bring a stricter policy of their own; it must win.
  if (isProd && !result.response.headers.has("Content-Security-Policy"))
    setResponseHeader("Content-Security-Policy", csp)
  setResponseHeader("X-Content-Type-Options", "nosniff")
  setResponseHeader("Referrer-Policy", "same-origin")
  setResponseHeader("X-Frame-Options", "DENY")
  setResponseHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
  setResponseHeader("Cross-Origin-Opener-Policy", "same-origin")
  setResponseHeader("Cross-Origin-Resource-Policy", "same-origin")
  if (getRequest().url.startsWith("https:"))
    setResponseHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  return result
})

const csrf = createCsrfMiddleware({
  filter: ({ request }) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return false
    return !new URL(request.url).pathname.startsWith("/api/v1/")
  },
})

/** Domain errors keep their code, status and field errors across the server-function boundary. */
const appErrorAdapter = createSerializationAdapter({
  key: "rt-app-error",
  test: (v): v is AppError => v instanceof AppError,
  toSerializable: (e) => ({
    message: e.message,
    code: e.code,
    status: e.status,
    fields: JSON.stringify(e.fields ?? null),
  }),
  fromSerializable: (v) => {
    const fields: unknown = JSON.parse(v.fields)
    return new AppError(v.message, { code: v.code, status: v.status, fields: isRecord(fields) ? fields : undefined })
  },
})

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders, csrf],
  serializationAdapters: [appErrorAdapter],
}))
