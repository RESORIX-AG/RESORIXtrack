import { describe, expect, it } from "vitest"
import { auth } from "./auth"
import { CLIENT_IP_HEADER, clientIp, PEER_HEADER, withClientIp } from "./client-ip"

const h = (headers: Record<string, string>) => new Headers(headers)
/** vitest sets BASE_URL to "/", so env.baseUrl is empty here and Better Auth derives its origin from the request */
const ORIGIN = "http://localhost:3210"
/** client, then the address each of two proxies saw */
const CHAIN = "203.0.113.9, 198.51.100.7, 10.0.0.2"

describe("clientIp", () => {
  it("takes the entry TRUSTED_PROXIES hops from the right of X-Forwarded-For", () => {
    expect(clientIp(h({ "x-forwarded-for": CHAIN }), 1)).toBe("10.0.0.2")
    expect(clientIp(h({ "x-forwarded-for": CHAIN }), 2)).toBe("198.51.100.7")
    expect(clientIp(h({ "x-forwarded-for": CHAIN }), 3)).toBe("203.0.113.9")
    expect(clientIp(h({ "x-forwarded-for": CHAIN }), 9)).toBe("203.0.113.9")
  })

  it("keeps the address the proxy appended when the client sends its own entry", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 10.0.0.2" }), 1)).toBe("10.0.0.2")
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 10.0.0.2" }), 1)).toBe("10.0.0.2")
  })

  it("ignores forwarded headers without a trusted proxy and uses the TCP peer", () => {
    expect(clientIp(h({ "x-forwarded-for": CHAIN }), 0)).toBe("")
    expect(clientIp(h({ "x-forwarded-for": CHAIN, [PEER_HEADER]: "10.0.0.5" }), 0)).toBe("10.0.0.5")
    expect(clientIp(h({ [PEER_HEADER]: "10.0.0.5" }), 1)).toBe("10.0.0.5")
    // a client could send X-Real-IP itself to get a fresh bucket for every request
    expect(clientIp(h({ "x-real-ip": "10.0.0.6" }), 0)).toBe("")
    expect(clientIp(undefined, 1)).toBe("")
  })
})

describe("withClientIp", () => {
  it("replaces any incoming value of the dedicated header with the computed address", () => {
    const spoofed = new Request("http://localhost/x", { headers: { [CLIENT_IP_HEADER]: "9.9.9.9" } })
    expect(withClientIp(spoofed).headers.get(CLIENT_IP_HEADER)).toBeNull()
    const real = new Request("http://localhost/x", {
      headers: { [CLIENT_IP_HEADER]: "9.9.9.9", [PEER_HEADER]: "10.0.0.1" },
    })
    expect(withClientIp(real).headers.get(CLIENT_IP_HEADER)).toBe("10.0.0.1")
  })

  it("keeps method, url, other headers and body", async () => {
    const req = withClientIp(
      new Request("http://localhost/api/auth/sign-in/email?x=1", {
        method: "POST",
        headers: { "content-type": "application/json", [PEER_HEADER]: "10.0.0.1" },
        body: JSON.stringify({ email: "a@example.nomail" }),
      }),
    )
    expect(req.method).toBe("POST")
    expect(req.url).toBe("http://localhost/api/auth/sign-in/email?x=1")
    expect(req.headers.get("content-type")).toBe("application/json")
    expect(await req.json()).toEqual({ email: "a@example.nomail" })
  })
})

// /two-factor/verify-totp: 10 per 5 minutes (auth.ts customRules); without a session it answers 401, never 429
const verifyTotp = (ip: string, extra: Record<string, string> = {}) =>
  auth.handler(
    new Request(`${ORIGIN}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, [PEER_HEADER]: ip, ...extra },
      body: JSON.stringify({ code: "000000" }),
    }),
  )

describe("Better Auth rate limit", () => {
  it("keys its buckets by client address: one flooding address does not block another", async () => {
    const first = await Promise.all(Array.from({ length: 10 }, () => verifyTotp("10.1.1.1")))
    expect(first.map((r) => r.status)).not.toContain(429)
    const blocked = await verifyTotp("10.1.1.1")
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("x-retry-after")).not.toBeNull()
    expect((await verifyTotp("10.1.1.2")).status).not.toBe(429)
  })

  it("does not let a client pick its bucket through the dedicated header", async () => {
    expect((await verifyTotp("10.1.1.1", { [CLIENT_IP_HEADER]: "10.1.1.3" })).status).toBe(429)
  })
})
