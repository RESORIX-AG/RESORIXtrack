/**
 * Client address behind TRUSTED_PROXIES hops. One helper for the sign-in log, the failed-attempt throttle and
 * Better Auth's rate limiter, which reads it from CLIENT_IP_HEADER: a header only the server sets per request
 * (`withClientIp` strips any incoming value), so every client gets its own bucket and nobody can pick another.
 */
import { env } from "./env"

export const CLIENT_IP_HEADER = "x-resorixtrack-client-ip"
/** The TCP peer address, set by server.mjs on every request (any incoming value is dropped there). */
export const PEER_HEADER = "x-resorixtrack-peer"

/**
 * Every proxy appends the address it saw to X-Forwarded-For, so with `trustedProxies` hops the client is the
 * entry that many from the right; everything left of it was supplied by the client. Without a trusted proxy
 * (or without X-Forwarded-For) the TCP peer is the client; X-Real-IP is never read, a client could set it.
 */
export function clientIp(headers: Headers | undefined | null, trustedProxies = env.trustedProxies): string {
  if (!headers) return ""
  if (trustedProxies > 0) {
    const xff = headers.get("x-forwarded-for")
    if (xff) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      return (parts[Math.max(0, parts.length - trustedProxies)] ?? "").slice(0, 64)
    }
  }
  return (headers.get(PEER_HEADER) ?? "").slice(0, 64)
}

/** The request with CLIENT_IP_HEADER set to the client address (removed when it is unknown). */
export function withClientIp(request: Request): Request {
  const headers = new Headers(request.headers)
  headers.delete(CLIENT_IP_HEADER)
  const ip = clientIp(headers)
  if (ip) headers.set(CLIENT_IP_HEADER, ip)
  // Built from url + init: the production server's request is not always the native Request class, and
  // `new Request(request, …)` then fails with "Failed to parse URL from [object Request]".
  const bodyless = request.method === "GET" || request.method === "HEAD"
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: bodyless ? null : request.body,
    signal: request.signal,
    redirect: request.redirect,
  }
  if (!bodyless) init.duplex = "half" // a streamed body needs this in Node
  return new Request(request.url, init)
}
