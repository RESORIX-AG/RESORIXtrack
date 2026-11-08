/** Same-origin redirect target after sign-in; anything else (`//evil`, `/\evil`, absolute URLs) becomes "/". */
export function safeNext(raw: string | null | undefined): string {
  if (!raw?.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/"
  try {
    const u = new URL(raw, "http://x.invalid")
    return u.origin === "http://x.invalid" ? u.pathname + u.search + u.hash : "/"
  } catch {
    return "/"
  }
}

/** i18n key for a Better Auth client error (`{ code, status }`). */
export function authErrorKey(err: { code?: string; status?: number } | null | undefined): string {
  const code = err?.code ?? ""
  if (err?.status === 429 || code === "TOO_MANY_REQUESTS" || code === "ACCOUNT_TEMPORARILY_LOCKED")
    return "errors.too_many_requests"
  if (code === "INACTIVE") return "auth.inactive"
  if (code === "OIDC_ONLY") return "auth.use_sso"
  if (code === "USE_STRONG_SIGN_IN") return "auth.use_strong_sign_in"
  if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE") return "errors.invalid_mfa"
  if (code === "INVALID_TWO_FACTOR_COOKIE" || code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") return "errors.mfa_expired"
  if (code === "INVALID_TOKEN") return "errors.invalid_token"
  if (code === "PASSWORD_COMPROMISED") return "errors.password_breached"
  const m = code.match(/^PASSWORD_(TOO_SHORT|TOO_LONG|TOO_COMMON|CONTAINS_EMAIL)$/)
  if (m) return `errors.password_${m[1].toLowerCase()}`
  if (code === "INVALID_PASSWORD") return "errors.invalid_password"
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "errors.invalid_credentials"
  return "errors.generic"
}

/** Remember a language chosen before sign-in (the server reads `rt_locale`). */
export function setLocaleCookie(locale: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not available in every supported browser
  document.cookie = `rt_locale=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`
}
