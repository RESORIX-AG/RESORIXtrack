import { createHmac } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { makeUser, withSettings } from "@/test/factories"
import { auth, setAuthMailer } from "./auth"
import { db } from "./db"
import { apikey, loginAttempts, passkey, session, users } from "./db/schema"
import { clearMailOutbox, mailOutbox } from "./services/mail"
import { grantPasskeyRegistration } from "./services/passkey-step-up"
import { afterPasswordChanged } from "./services/profile"
import { setPassword } from "./services/user-auth"

const PW = "correct horse battery"
const UA = { "user-agent": "vitest", "x-resorixtrack-peer": "10.0.0.1" }

function cookieHeader(res: { headers: Headers }, prev = ""): string {
  const jar = new Map(prev ? prev.split("; ").map((c) => c.split("=") as [string, string]) : [])
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";")
    const i = pair.indexOf("=")
    const value = pair.slice(i + 1)
    if (value) jar.set(pair.slice(0, i), value)
    else jar.delete(pair.slice(0, i))
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
}

async function signIn(email: string, password = PW) {
  const res = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true, headers: new Headers(UA) })
  return { res: res.response as { token?: string; twoFactorRedirect?: boolean }, cookie: cookieHeader(res) }
}

async function person(over: Parameters<typeof makeUser>[0] = {}) {
  const u = makeUser(over)
  await setPassword(u.id, PW)
  return u
}

const attempts = () => db.select().from(loginAttempts).orderBy(desc(loginAttempts.id)).all()

function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0")
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? [])
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)))
  const h = createHmac("sha1", key).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0")
}

beforeEach(() => clearMailOutbox())

describe("sign-in log", () => {
  it("records success, wrong password, unknown email (masked) and inactive accounts", async () => {
    const u = await person({ email: "anna@example.nomail" })
    await signIn(u.email)
    await expect(signIn(u.email, "wrong password!")).rejects.toThrow()
    await expect(signIn("nobody@example.nomail")).rejects.toThrow()
    db.update(users).set({ isActive: false }).where(eq(users.id, u.id)).run()
    await expect(signIn(u.email)).rejects.toMatchObject({ body: { code: "INACTIVE" } })
    const rows = attempts()
    expect(rows.map((r) => r.reason)).toEqual(["inactive", "unknown_user", "invalid_password", "ok"])
    expect(rows[1].email).toBe("no***@example.nomail")
    expect(rows[3]).toMatchObject({ success: true, userId: u.id, userAgent: "vitest" })
  })

  it("blocks an email + address after too many failures and logs it once", async () => {
    const u = await person()
    await Promise.all(Array.from({ length: 5 }, () => expect(signIn(u.email, "wrong password!")).rejects.toThrow()))
    await expect(signIn(u.email)).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" })
    await expect(signIn(u.email)).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" })
    expect(attempts().filter((r) => r.reason === "throttled")).toHaveLength(1)
  })
})

describe("password change", () => {
  it("requires the current password, applies the policy and revokes other sessions and keys", async () => {
    const u = await person({ email: "maxmuster@example.nomail" })
    const first = await signIn(u.email)
    await signIn(u.email)
    expect(db.select().from(session).where(eq(session.userId, u.id)).all()).toHaveLength(2)
    const headers = new Headers({ cookie: first.cookie, ...UA })
    await expect(
      auth.api.changePassword({
        body: { currentPassword: "wrong password!", newPassword: "a fresh passphrase", revokeOtherSessions: true },
        headers,
      }),
    ).rejects.toMatchObject({ body: { code: "INVALID_PASSWORD" } })
    await expect(
      auth.api.changePassword({
        body: { currentPassword: PW, newPassword: "maxmuster-2026!", revokeOtherSessions: true },
        headers,
      }),
    ).rejects.toMatchObject({ body: { code: "PASSWORD_CONTAINS_EMAIL" } })
    await auth.api.createApiKey({ body: { userId: String(u.id), name: "laptop" } })
    await auth.api.changePassword({
      body: { currentPassword: PW, newPassword: "a fresh passphrase", revokeOtherSessions: true },
      headers,
    })
    afterPasswordChanged(u.id)
    const left = db.select().from(session).where(eq(session.userId, u.id)).all()
    expect(left).toHaveLength(1)
    expect(left[0].token).not.toBe(first.res.token)
    expect(
      db
        .select()
        .from(apikey)
        .where(eq(apikey.referenceId, String(u.id)))
        .all(),
    ).toHaveLength(0)
    expect(db.select().from(users).where(eq(users.id, u.id)).get()?.passwordChangedAt).toBeTruthy()
    await expect(signIn(u.email, "a fresh passphrase")).resolves.toBeTruthy()
  })
})

describe("two-factor", () => {
  it("enrols and logs both sign-in steps", async () => {
    const u = await person()
    const s = await signIn(u.email)
    const headers = new Headers({ cookie: s.cookie, ...UA })
    const enabled = await auth.api.enableTwoFactor({ body: { password: PW }, headers })
    if (enabled.method !== "totp") throw new Error("expected totp")
    const secret = new URL(enabled.totpURI).searchParams.get("secret") as string
    await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers })
    expect(db.select().from(users).where(eq(users.id, u.id)).get()).toMatchObject({
      twoFactorEnabled: true,
    })

    const login = await signIn(u.email)
    expect(login.res.twoFactorRedirect).toBe(true)
    const challenge = new Headers({ cookie: login.cookie, ...UA })
    await expect(auth.api.verifyTOTP({ body: { code: "000000" }, headers: challenge })).rejects.toThrow()
    // "trust this device" is never granted, whatever the client asks for
    const verified = await auth.api.verifyTOTP({
      body: { code: totp(secret), trustDevice: true },
      headers: challenge,
      returnHeaders: true,
    })
    expect(verified.headers.getSetCookie().some((c) => c.includes("trust_device"))).toBe(false)
    // the password step of a two-factor sign-in is not a sign-in of its own
    expect(attempts().map((r) => [r.reason, r.success])).toEqual([
      ["ok", true],
      ["mfa_failed", false],
      ["ok", true],
    ])
  })

  it("cannot be disabled while required by policy", async () => {
    withSettings({ mfa_required_for_all: true })
    const u = await person()
    const s = await signIn(u.email)
    await expect(
      auth.api.disableTwoFactor({ body: { password: PW }, headers: new Headers({ cookie: s.cookie }) }),
    ).rejects.toMatchObject({
      body: { code: "MFA_REQUIRED" },
    })
  })
})

describe("password reset", () => {
  it("answers the same for unknown, inactive and active accounts and only mails the active one", async () => {
    const sent: string[] = []
    setAuthMailer(async (_k, to, url) => {
      sent.push(`${to.email} ${url}`)
    })
    const active = await person({ email: "active@example.nomail" })
    await person({ email: "inactive@example.nomail", isActive: false })
    await Promise.all(
      [active.email, "inactive@example.nomail", "ghost@example.nomail"].map((email) =>
        expect(auth.api.requestPasswordReset({ body: { email }, headers: new Headers(UA) })).resolves.toMatchObject({
          status: true,
        }),
      ),
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/^active@example\.nomail \S*\/reset#token=/)
    expect(attempts().filter((r) => r.reason === "reset_requested")).toHaveLength(3)

    const token = sent[0].split("#token=")[1]
    await expect(auth.api.resetPassword({ body: { token, newPassword: "1234567890" } })).rejects.toMatchObject({
      body: { code: "PASSWORD_TOO_COMMON" },
    })
    await auth.api.resetPassword({ body: { token, newPassword: "another fine passphrase" } })
    expect(attempts()[0]).toMatchObject({ reason: "reset", success: true, userId: active.id })
    expect(mailOutbox().map((m) => m.kind)).toEqual(["password_changed"])
    await expect(auth.api.resetPassword({ body: { token, newPassword: "yet another passphrase" } })).rejects.toThrow()
  })

  it("sends a fresh invitation to people who never set a password", async () => {
    const u = makeUser({ email: "new@example.nomail" })
    await auth.api.requestPasswordReset({ body: { email: u.email } })
    expect(mailOutbox().map((m) => [m.kind, m.to])).toEqual([["invite", u.email]])
  })
})

const ORIGIN = "http://localhost:3210"
const post = (route: string, cookie: string, body: unknown = {}) =>
  auth.handler(
    new Request(`${ORIGIN}/api/auth${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie, ...UA },
      body: JSON.stringify(body),
    }),
  )

describe("endpoints the app only uses on the server", () => {
  it("are not reachable over HTTP, so their checks cannot be skipped", async () => {
    const u = await person()
    const { cookie } = await signIn(u.email)
    expect((await post("/api-key/create", cookie, { name: "x" })).status).toBe(404)
    expect((await post("/api-key/update", cookie, { keyId: "1", enabled: true })).status).toBe(404)
    expect((await post("/update-user", cookie, { name: "" })).status).toBe(404)
    expect((await post("/change-password", cookie, { currentPassword: PW, newPassword: "x".repeat(12) })).status).toBe(
      404,
    )
    expect(
      db
        .select()
        .from(apikey)
        .where(eq(apikey.referenceId, String(u.id)))
        .all(),
    ).toEqual([])
  })
})

describe("passkeys", () => {
  it("can only be registered right after confirming the password", async () => {
    const u = await person()
    const { cookie } = await signIn(u.email)
    const options = () =>
      auth.handler(new Request(`${ORIGIN}/api/auth/passkey/generate-register-options`, { headers: { cookie, ...UA } }))
    const refused = await options()
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { code: string }).code).toBe("PASSWORD_CONFIRMATION_REQUIRED")
    grantPasskeyRegistration(u.id)
    expect((await options()).status).toBe(200)
  })

  it("replace the password when two-factor is required and TOTP is off", async () => {
    const u = await person()
    db.insert(passkey)
      .values({
        userId: u.id,
        publicKey: "k",
        credentialID: "c",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      })
      .run()
    withSettings({ mfa_required_for_all: true })
    await expect(signIn(u.email)).rejects.toMatchObject({ body: { code: "USE_STRONG_SIGN_IN" } })
    expect(db.select().from(session).where(eq(session.userId, u.id)).all()).toEqual([])
    expect(attempts()[0]).toMatchObject({ reason: "mfa_required", success: false })
  })
})
