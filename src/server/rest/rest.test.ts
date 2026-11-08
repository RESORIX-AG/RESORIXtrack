import { desc, eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { lockMonth, makeAbsenceRow, makeEntry, makeLead, makeOrg, makeUser, withSettings } from "@/test/factories"
import { auth } from "../auth"
import { db } from "../db"
import { absenceTypes, apikey, loginAttempts, passkey, session, timeEntries, users } from "../db/schema"
import { env } from "../env"
import { breakGlassAllowed, grantBreakGlass } from "../services/break-glass"
import { setPassword } from "../services/user-auth"
import { signInBuckets } from "./app-token"
import { keyBuckets } from "./auth"
import { SCOPES, type Scope } from "./endpoint"
import { ENDPOINTS } from "./endpoints"
import { handleRest } from "./router"

const ALL: Scope[] = [...SCOPES]

async function keyFor(userId: number, scopes: Scope[] = ALL, expiresIn?: number): Promise<string> {
  const permissions: Record<string, string[]> = {}
  for (const s of scopes) {
    const [res, action] = s.split(":")
    permissions[res] = [...(permissions[res] ?? []), action]
  }
  const created = await auth.api.createApiKey({
    body: { userId: String(userId), name: "test", permissions, ...(expiresIn ? { expiresIn } : {}) },
  })
  return created.key
}

async function call(
  key: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await handleRest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
  const text = await res.text()
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null }
}

let org: ReturnType<typeof makeOrg>
beforeEach(() => {
  keyBuckets.reset()
  org = makeOrg()
})

describe("authentication", () => {
  it("rejects missing, invalid and expired keys and inactive owners with 401", async () => {
    expect((await call(null, "GET", "/me")).status).toBe(401)
    const bad = await call("rt_nope", "GET", "/me")
    expect(bad.status).toBe(401)
    expect(bad.json.error.code).toBe("unauthorized")
    expect(bad.headers.get("www-authenticate")).toContain("Bearer")
    const key = await keyFor(org.anna.id)
    db.update(apikey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run()
    expect((await call(key, "GET", "/me")).status).toBe(401)
    const key2 = await keyFor(org.ben.id)
    db.update(users).set({ isActive: false }).where(eq(users.id, org.ben.id)).run()
    expect((await call(key2, "GET", "/me")).status).toBe(401)
  })

  it("is switched off company-wide by api_tokens_enabled", async () => {
    const key = await keyFor(org.anna.id)
    withSettings({ api_tokens_enabled: false })
    const r = await call(key, "GET", "/me")
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe("api_keys_disabled")
  })

  it("never accepts a session cookie", async () => {
    const r = await call(null, "GET", "/me", undefined, { cookie: "rt.session_token=whatever" })
    expect(r.status).toBe(401)
  })

  it("records the last use and counts requests", async () => {
    const key = await keyFor(org.anna.id)
    await call(key, "GET", "/me")
    await call(key, "GET", "/me")
    const row = db.select().from(apikey).get()!
    expect(row.requestCount).toBe(2)
    expect(row.lastRequest).toBeTruthy()
  })

  it("rate-limits per key with 429 and Retry-After", async () => {
    const key = await keyFor(org.anna.id)
    const id = String(db.select().from(apikey).get()!.id)
    while (keyBuckets.take(id) === 0) {
      // drain the bucket
    }
    const r = await call(key, "GET", "/me")
    expect(r.status).toBe(429)
    expect(r.json.error.code).toBe("too_many_requests")
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0)
    const other = await keyFor(org.ben.id)
    expect((await call(other, "GET", "/me")).status).toBe(200)
  })

  it("answers unknown paths with 404 and wrong methods with 405", async () => {
    const key = await keyFor(org.anna.id)
    expect((await call(key, "GET", "/nope")).status).toBe(404)
    expect((await call(key, "PUT", "/me")).status).toBe(405)
    expect((await call(key, "GET", "/entries/abc")).status).toBe(404)
  })
})

describe("scopes", () => {
  it("every endpoint refuses keys without its scope (403 insufficient_scope)", async () => {
    await Promise.all(
      ENDPOINTS.filter((e) => e.scope).map(async (ep) => {
        const others = ALL.filter((s) => s !== ep.scope)
        const key = await keyFor(org.hr!.id, others)
        const path = ep.path.replace("{id}", "1")
        const r = await call(key, ep.method, path, ep.method === "GET" ? undefined : {})
        expect(r.status, `${ep.method} ${ep.path}`).toBe(403)
        expect(r.json.error.code).toBe("insufficient_scope")
      }),
    )
  })

  it("another person's data needs reports:read on top of the endpoint scope", async () => {
    const key = await keyFor(org.lead.id, ["time:read"])
    const r = await call(key, "GET", `/days?from=2026-11-02&to=2026-11-06&userId=${org.anna.id}`)
    expect(r.status).toBe(403)
    expect(r.json.error.fields.scope).toBe("reports:read")
    const e = makeEntry(org.anna.id, "2026-11-02T08:00:00Z", "2026-11-02T12:00:00Z")
    expect((await call(key, "GET", `/entries/${e.id}`)).status).toBe(403)
    const full = await keyFor(org.lead.id, ["time:read", "reports:read"])
    expect((await call(full, "GET", `/entries/${e.id}`)).status).toBe(200)
  })
})

describe("me and people", () => {
  it("GET /me describes the owner and the key's scopes", async () => {
    const key = await keyFor(org.lead.id, ["time:read", "reports:read"])
    const r = await call(key, "GET", "/me")
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({
      id: org.lead.id,
      name: "Lea Lead",
      isLead: true,
      isHr: false,
      scopes: ["reports:read", "time:read"],
      company: { timezone: "Europe/Zurich" },
    })
  })

  it("GET /users lists visible people for leads and HR only, paginated", async () => {
    const emp = await call(await keyFor(org.anna.id), "GET", "/users")
    expect(emp.status).toBe(403)
    const lead = await call(await keyFor(org.lead.id), "GET", "/users")
    expect(lead.json.items.map((p: { name: string }) => p.name).sort()).toEqual([
      "Anna Muster",
      "Ben Beispiel",
      "Lea Lead",
    ])
    const hrKey = await keyFor(org.hr!.id)
    const first = await call(hrKey, "GET", "/users?limit=2")
    expect(first.json.items).toHaveLength(2)
    const seen = [...first.json.items]
    let cursor = first.json.nextCursor
    while (cursor) {
      // each page needs the previous page's cursor
      // oxlint-disable-next-line eslint/no-await-in-loop
      const next = await call(hrKey, "GET", `/users?limit=2&cursor=${cursor}`)
      seen.push(...next.json.items)
      cursor = next.json.nextCursor
    }
    expect(seen).toHaveLength(6)
    expect((await call(hrKey, "GET", "/users?cursor=%%%")).status).toBe(422)
  })
})

describe("clock", () => {
  it("clocks in and out (a break is a clock-out); actions are idempotent", async () => {
    const key = await keyFor(org.anna.id)
    const a = await call(key, "POST", "/clock/in")
    expect(a.status).toBe(200)
    expect(a.json).toMatchObject({ state: "working", replayed: false, scheduledEnd: null })
    expect((await call(key, "POST", "/clock/in")).json.state).toBe("working")
    expect((await call(key, "POST", "/clock/out", {})).json.state).toBe("idle")
    expect((await call(key, "POST", "/clock/in")).json.state).toBe("working")
    expect((await call(key, "POST", "/clock/out")).json.state).toBe("idle")
    expect((await call(key, "GET", "/clock")).json).toMatchObject({ state: "idle", entry: null, scheduledEnd: null })
    const rows = db.select().from(timeEntries).where(eq(timeEntries.userId, org.anna.id)).all()
    expect(rows.map((r) => r.source)).toEqual(["api", "api"])
  })

  it("schedules a clock-out with a future time, cancels it, refuses more than 24 h", async () => {
    const key = await keyFor(org.anna.id)
    await call(key, "POST", "/clock/in")
    const planned = await call(key, "POST", "/clock/out", { at: "2026-11-05T16:00:00Z" })
    expect(planned.json).toMatchObject({ state: "working", scheduledEnd: "2026-11-05T16:00:00.000Z" })
    expect(planned.json.entry).toMatchObject({ running: true, scheduledEndAt: "2026-11-05T16:00:00.000Z" })
    expect((await call(key, "GET", "/clock")).json.scheduledEnd).toBe("2026-11-05T16:00:00.000Z")
    expect((await call(key, "POST", "/clock/unschedule")).json).toMatchObject({ state: "working", scheduledEnd: null })
    expect((await call(key, "POST", "/clock/unschedule")).json.scheduledEnd).toBeNull()
    const late = await call(key, "POST", "/clock/out", { at: "2026-11-06T08:30:00Z" })
    expect(late.status).toBe(422)
    expect(late.json.error.fields.at).toBe("too_late")
    expect((await call(key, "POST", "/clock/out")).json.state).toBe("idle")
  })

  it("refuses a clock-in before the legal minimum break with 409", async () => {
    const key = await keyFor(org.anna.id)
    makeEntry(org.anna.id, "2026-11-05T01:55:00Z", "2026-11-05T07:55:00Z", { source: "clock" }) // 6 h, 5 min ago
    const r = await call(key, "POST", "/clock/in")
    expect(r.status).toBe(409)
    expect(r.json.error).toMatchObject({
      code: "break_required",
      fields: { required: 15, taken: 5, earliest: "2026-11-05T08:10:00.000Z" },
    })
    const sync = await call(key, "POST", "/clock/sync", {
      actions: [{ clientId: "s1", action: "in", at: "2026-11-05T07:59:00Z" }],
    })
    expect(sync.json.results).toEqual([{ clientId: "s1", status: "rejected", code: "break_required" }])
    withSettings({ break_enforcement: false })
    expect((await call(key, "POST", "/clock/in")).status).toBe(200)
  })

  it("replays a clientId without changing anything and marks desktop clients", async () => {
    const key = await keyFor(org.anna.id)
    const desk = { "x-client": "desktop/2.0" }
    const first = await call(key, "POST", "/clock/in", { clientId: "c-1", at: "2026-11-05T07:30:00Z" }, desk)
    expect(first.json).toMatchObject({ state: "working", replayed: false, since: "2026-11-05T07:30:00.000Z" })
    await call(key, "POST", "/clock/out", { clientId: "c-2" }, desk)
    const again = await call(key, "POST", "/clock/in", { clientId: "c-1" }, desk)
    expect(again.json).toMatchObject({ state: "idle", replayed: true })
    const rows = db.select().from(timeEntries).where(eq(timeEntries.userId, org.anna.id)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe("desktop")
  })

  it("validates times and reports conflicts", async () => {
    const key = await keyFor(org.anna.id)
    const future = await call(key, "POST", "/clock/in", { at: "2026-11-06T08:00:00Z" })
    expect(future.status).toBe(422)
    expect(future.json.error.fields.at).toBe("future")
    expect((await call(key, "POST", "/clock/in", { at: 5 })).status).toBe(422)
    expect((await call(key, "POST", "/clock/in", "{")).status).toBe(422)
    const bad = await handleRest(
      new Request("http://localhost/api/v1/clock/in", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: "{not json",
      }),
    )
    expect(bad.status).toBe(400)
  })

  it("syncs offline actions once per clientId", async () => {
    const key = await keyFor(org.anna.id)
    const actions = [
      { clientId: "a", action: "in", at: "2026-11-05T06:00:00Z" },
      { clientId: "b", action: "out", at: "2026-11-05T07:00:00Z" },
    ]
    const r = await call(key, "POST", "/clock/sync", { actions })
    expect(r.json.results).toEqual([
      { clientId: "a", status: "applied" },
      { clientId: "b", status: "applied" },
    ])
    const again = await call(key, "POST", "/clock/sync", { actions })
    expect(again.json.results.map((x: { status: string }) => x.status)).toEqual(["duplicate", "duplicate"])
    expect((await call(key, "POST", "/clock/sync", { actions: [] })).status).toBe(422)
  })
})

describe("entries and days", () => {
  it("creates, lists (paginated), reads, changes and deletes own entries", async () => {
    const key = await keyFor(org.anna.id)
    const c = await call(key, "POST", "/entries", { startAt: "2026-11-05T06:00:00Z", endAt: "2026-11-05T07:00:00Z" })
    expect(c.status).toBe(201)
    expect(c.json).toMatchObject({ kind: "work", source: "api", minutes: 60, startAt: "2026-11-05T06:00:00.000Z" })
    expect(c.json).not.toHaveProperty("createdById")
    await call(key, "POST", "/entries", {
      startAt: "2026-11-04T06:00:00Z",
      endAt: "2026-11-04T07:00:00Z",
      reason: "forgot",
    })
    const p1 = await call(key, "GET", "/entries?from=2026-11-01&to=2026-11-30&limit=1")
    expect(p1.json.items[0].startAt).toBe("2026-11-04T06:00:00.000Z")
    const p2 = await call(key, "GET", `/entries?from=2026-11-01&to=2026-11-30&limit=1&cursor=${p1.json.nextCursor}`)
    expect(p2.json.items[0].id).toBe(c.json.id)
    expect(p2.json.nextCursor).toBeNull()
    expect((await call(key, "GET", `/entries/${c.json.id}`)).json.id).toBe(c.json.id)
    const u = await call(key, "PATCH", `/entries/${c.json.id}`, { note: "standup" })
    expect(u.json.note).toBe("standup")
    const noReason = await call(key, "DELETE", `/entries/${c.json.id}`)
    expect(noReason.status).toBe(422) // deleting always needs a reason
    expect((await call(key, "DELETE", `/entries/${c.json.id}`, { reason: "booked twice" })).status).toBe(204)
    const list = await call(key, "GET", "/entries?from=2026-11-05&to=2026-11-05&includeDeleted=true")
    expect(list.json.items[0].deleted).toBe(true)
  })

  it("never writes other people's entries, even a lead's key for a member", async () => {
    const e = makeEntry(org.anna.id, "2026-11-02T08:00:00Z", "2026-11-02T12:00:00Z")
    const key = await keyFor(org.lead.id)
    expect((await call(key, "PATCH", `/entries/${e.id}`, { note: "x", reason: "x" })).status).toBe(404)
    expect((await call(key, "DELETE", `/entries/${e.id}`, { reason: "x" })).status).toBe(404)
    const carl = await keyFor(org.carl.id)
    expect((await call(carl, "GET", `/entries/${e.id}`)).status).toBe(404)
  })

  it("validates input with field errors and refuses signed-off months", async () => {
    const key = await keyFor(org.anna.id)
    const v = await call(key, "POST", "/entries", { startAt: "x" })
    expect(v.status).toBe(422)
    expect(v.json.error).toMatchObject({ code: "validation_error", fields: { endAt: expect.any(String) } })
    lockMonth(org.anna.id, "2026-10")
    const locked = await call(key, "POST", "/entries", {
      startAt: "2026-10-05T06:00:00Z",
      endAt: "2026-10-05T07:00:00Z",
      reason: "late",
    })
    expect(locked.status).toBe(409)
    expect(locked.json.error.code).toBe("period_signed_off")
  })

  it("GET /days returns per-day figures and a summary; leads read members with reports:read", async () => {
    makeEntry(org.anna.id, "2026-11-02T07:00:00Z", "2026-11-02T15:24:00Z")
    const own = await call(await keyFor(org.anna.id), "GET", "/days?from=2026-11-02&to=2026-11-06")
    expect(own.json.days).toHaveLength(5)
    expect(own.json.days[0]).toMatchObject({ date: "2026-11-02", workedMin: 504, targetMin: 504 })
    expect(own.json.summary.workdays).toBe(5)
    // frozen at Thu 2026-11-05 09:00 Zurich: today is in progress and not part of target/delta
    expect(own.json.days.map((d: { isToday: boolean }) => d.isToday)).toEqual([false, false, false, true, false])
    expect(own.json.summary).toMatchObject({
      targetMin: 3 * 504,
      workedCompleteMin: 504,
      deltaMin: 504 - 3 * 504,
      todayTargetMin: 504,
      todayWorkedMin: 0,
      targetTotalMin: 5 * 504,
    })
    const lead = await keyFor(org.lead.id)
    expect((await call(lead, "GET", `/days?from=2026-11-02&to=2026-11-02&userId=${org.anna.id}`)).status).toBe(200)
    expect((await call(lead, "GET", `/days?from=2026-11-02&to=2026-11-02&userId=${org.carl.id}`)).status).toBe(404)
    expect((await call(lead, "GET", "/days?from=2026-11-02&to=2028-11-02")).status).toBe(422)
    expect((await call(lead, "GET", "/days?from=2026-11-05&to=2026-11-02")).status).toBe(422)
  })

  it("administrators without HR never read time data of others", async () => {
    const key = await keyFor(org.admin.id)
    expect((await call(key, "GET", `/days?from=2026-11-02&to=2026-11-02&userId=${org.anna.id}`)).status).toBe(404)
    expect((await call(key, "GET", `/balance?userId=${org.anna.id}`)).status).toBe(404)
    expect((await call(key, "GET", "/users")).status).toBe(403)
  })
})

describe("absences and accounts", () => {
  it("lists types, requests, reads and cancels own absences", async () => {
    const key = await keyFor(org.anna.id)
    const types = await call(key, "GET", "/absence-types")
    expect(types.json.items.find((t: { key: string }) => t.key === "vacation")).toMatchObject({ requestable: true })
    const c = await call(key, "POST", "/absences", { type: "vacation", startDate: "2026-12-14", endDate: "2026-12-15" })
    expect(c.status).toBe(201)
    expect(c.json).toMatchObject({ status: "pending", days: 2, type: { key: "vacation" }, user: { id: org.anna.id } })
    expect(c.json).not.toHaveProperty("permissions")
    const list = await call(key, "GET", "/absences?from=2026-12-01&to=2026-12-31&status=pending")
    expect(list.json.items.map((a: { id: number }) => a.id)).toEqual([c.json.id])
    expect((await call(key, "GET", "/absences?from=2026-12-01&to=2026-12-31&status=bogus")).status).toBe(422)
    expect((await call(key, "GET", `/absences/${c.json.id}`)).json.id).toBe(c.json.id)
    const x = await call(key, "POST", `/absences/${c.json.id}/cancel`, { reason: "plans changed" })
    expect(x.json.status).toBe("cancelled")
  })

  it("never cancels other people's absences and hides foreign ones", async () => {
    const sick = db.select().from(absenceTypes).where(eq(absenceTypes.key, "sick")).get()!
    const a = makeAbsenceRow(org.anna.id, sick.id, "2026-11-03")
    const lead = await keyFor(org.lead.id)
    expect((await call(lead, "POST", `/absences/${a.id}/cancel`, {})).status).toBe(404)
    expect((await call(lead, "GET", `/absences/${a.id}`)).status).toBe(200)
    const ben = await keyFor(org.ben.id)
    expect((await call(ben, "GET", `/absences/${a.id}`)).status).toBe(404)
    expect((await call(ben, "GET", `/absences?from=2026-11-01&to=2026-11-30&userId=${org.anna.id}`)).status).toBe(404)
  })

  it("GET /balance and /vacation", async () => {
    const key = await keyFor(org.anna.id)
    const b = await call(key, "GET", "/balance")
    expect(b.json).toMatchObject({ userId: org.anna.id, asOf: "2026-11-04" })
    const v = await call(key, "GET", "/vacation?year=2026")
    expect(v.json).toMatchObject({ userId: org.anna.id, year: 2026, entitlement: 25 })
    expect((await call(key, "GET", "/vacation?year=abc")).status).toBe(422)
  })

  it("GET /holidays: the calendar that applies to the owner, time:read only", async () => {
    const key = await keyFor(org.anna.id)
    const h = await call(key, "GET", "/holidays?year=2026")
    expect(h.json).toMatchObject({
      userId: org.anna.id,
      year: 2026,
      source: "default",
      team: null,
      years: [2026, 2027],
      items: [{ date: "2026-12-08" }, { date: "2026-12-25", name: "Christmas", fraction: 1 }],
    })
    expect((await call(key, "GET", "/holidays?year=2025")).json.items).toEqual([])
    expect((await call(key, "GET", "/holidays?year=abc")).status).toBe(422)
    expect((await call(await keyFor(org.anna.id, ["absences:read"]), "GET", "/holidays")).status).toBe(403)
  })
})

describe("reports", () => {
  it("GET /reports/timesheet for oneself and for a led member", async () => {
    makeEntry(org.anna.id, "2026-11-02T07:00:00Z", "2026-11-02T15:00:00Z", { note: "release" })
    const own = await call(await keyFor(org.anna.id), "GET", "/reports/timesheet?month=2026-11")
    expect(own.status).toBe(200)
    expect(own.json).toMatchObject({ year: 2026, month: 11, user: { id: org.anna.id } })
    expect(own.json.entries["2026-11-02"][0]).toMatchObject({ start: "08:00", note: "release" })
    const lead = await keyFor(org.lead.id)
    expect((await call(lead, "GET", `/reports/timesheet?month=2026-11&userId=${org.anna.id}`)).status).toBe(200)
    expect((await call(lead, "GET", `/reports/timesheet?month=2026-11&userId=${org.carl.id}`)).status).toBe(404)
    expect((await call(lead, "GET", "/reports/timesheet?month=2026-13")).status).toBe(422)
  })

  it("a deputy outside the validity period sees nothing of the team", async () => {
    const dep = makeUser({ name: "Dora Deputy" })
    makeLead(org.teamB.id, dep.id, { role: "deputy", validFrom: "2025-01-01", validTo: "2025-12-31" })
    const key = await keyFor(dep.id)
    expect((await call(key, "GET", `/reports/timesheet?month=2026-11&userId=${org.carl.id}`)).status).toBe(404)
    expect((await call(key, "GET", "/users")).status).toBe(403)
  })
})

const attempts = () => db.select().from(loginAttempts).orderBy(desc(loginAttempts.id)).all()

/** `name=value` pairs of a response's cookies (expired ones dropped). */
const cookieOf = (h: Headers) =>
  h
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ")

/** The raw secret behind an `otpauth://` URI: Better Auth's secrets are ASCII, base32-encoded in the URI. */
function rawSecret(totpURI: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const encoded = new URL(totpURI).searchParams.get("secret") ?? ""
  let bits = ""
  for (const ch of encoded.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0")
  return String.fromCharCode(...(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []))
}

describe("app sign-in (POST /auth/token)", () => {
  const PW = "correct horse battery"
  const UA = { "user-agent": "vitest desktop", "x-resorixtrack-peer": "10.0.0.7" }
  const signIn = (body: Record<string, unknown>, headers: Record<string, string> = UA) =>
    call(null, "POST", "/auth/token", body, headers)

  /** Enrol TOTP as the profile page does; returns a generator of current codes and the backup codes. */
  async function enrolTotp(email: string) {
    const s = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true })
    const headers = new Headers({ cookie: cookieOf(s.headers) })
    const enabled = await auth.api.enableTwoFactor({ body: { password: PW }, headers })
    if (enabled.method !== "totp") throw new Error("expected totp")
    const secret = rawSecret(enabled.totpURI)
    const code = async () => (await auth.api.generateTOTP({ body: { secret } })).code
    await auth.api.verifyTOTP({ body: { code: await code() }, headers })
    db.delete(session).run()
    return { code, backupCodes: enabled.backupCodes }
  }

  beforeEach(async () => {
    signInBuckets.reset()
    await setPassword(org.anna.id, PW)
  })

  it("issues a key for email and password that then works on GET /me", async () => {
    const r = await signIn({ email: org.anna.email, password: PW, name: "Laptop" })
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    expect(r.json).toMatchObject({ name: "Laptop", scopes: [...ALL].sort() })
    expect(r.json.token).toMatch(/^rt_/)
    const days = (new Date(r.json.expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(89.9)
    expect(days).toBeLessThanOrEqual(90)
    const me = await call(r.json.token, "GET", "/me")
    expect(me.status).toBe(200)
    expect(me.json).toMatchObject({ id: org.anna.id, scopes: [...ALL].sort() })
    expect(db.select().from(apikey).all()).toHaveLength(1)
    expect(db.select().from(session).all()).toHaveLength(0)
    expect(attempts()[0]).toMatchObject({ reason: "token_issued", success: true, userId: org.anna.id, ip: "10.0.0.7" })
    expect(db.select().from(users).where(eq(users.id, org.anna.id)).get()?.lastLoginAt).toBeTruthy()
    // narrower scopes and a shorter life
    const s = await signIn({
      email: org.anna.email,
      password: PW,
      name: "Phone",
      scopes: ["time:read"],
      expiresInDays: 10,
    })
    expect(s.json.scopes).toEqual(["time:read"])
    expect((new Date(s.json.expiresAt).getTime() - Date.now()) / 86_400_000).toBeLessThanOrEqual(10)
    expect((await call(s.json.token, "POST", "/clock/in")).json.error.code).toBe("insufficient_scope")
  })

  it("refuses wrong passwords, unknown addresses and inactive people with 401 and logs them", async () => {
    const wrong = await signIn({ email: org.anna.email, password: "nope", name: "x" })
    expect(wrong.status).toBe(401)
    expect(wrong.json.error.code).toBe("invalid_credentials")
    expect(attempts()[0]).toMatchObject({ reason: "invalid_password", success: false, userId: org.anna.id })
    expect((await signIn({ email: "nobody@example.nomail", password: PW, name: "x" })).status).toBe(401)
    expect(attempts()[0]).toMatchObject({ reason: "unknown_user", email: "no***@example.nomail" })
    await setPassword(org.ben.id, PW)
    db.update(users).set({ isActive: false }).where(eq(users.id, org.ben.id)).run()
    const inactive = await signIn({ email: org.ben.email, password: PW, name: "x" })
    expect(inactive.status).toBe(401)
    expect(inactive.json.error.code).toBe("invalid_credentials")
    expect(attempts()[0]).toMatchObject({ reason: "inactive", userId: org.ben.id })
    expect(db.select().from(apikey).all()).toHaveLength(0)
  })

  it("is switched off by api_tokens_enabled and in OIDC-only mode, except through the break-glass window", async () => {
    withSettings({ api_tokens_enabled: false })
    const off = await signIn({ email: org.anna.email, password: PW, name: "x" })
    expect(off.status).toBe(403)
    expect(off.json.error.code).toBe("api_keys_disabled")
    withSettings({ api_tokens_enabled: true })
    const saved = { ...env.oidc }
    Object.assign(env.oidc, { only: true, issuer: "https://id.example.nomail", clientId: "rt" })
    try {
      const sso = await signIn({ email: org.anna.email, password: PW, name: "x" })
      expect(sso.status).toBe(403)
      expect(sso.json.error.code).toBe("oidc_only")
      grantBreakGlass(org.anna.email)
      expect((await signIn({ email: org.anna.email, password: PW, name: "x" })).status).toBe(201)
      expect(breakGlassAllowed(org.anna.email)).toBe(false)
    } finally {
      Object.assign(env.oidc, saved)
    }
  })

  it("validates scopes, name and expiry (422) before touching credentials", async () => {
    const bad = await signIn({ email: org.anna.email, password: PW, name: "x", scopes: ["admin"] })
    expect(bad.status).toBe(422)
    expect(bad.json.error.fields.scopes).toBe("invalid")
    expect((await signIn({ email: org.anna.email, password: PW })).json.error.fields.name).toBeTruthy()
    const long = await signIn({ email: org.anna.email, password: PW, name: "x", expiresInDays: 400 })
    expect(long.json.error.fields.expiresInDays).toBeTruthy()
    expect(attempts()).toHaveLength(0)
    expect(db.select().from(apikey).all()).toHaveLength(0)
  })

  it("requires the second factor when enabled: a current authenticator code or a backup code (once)", async () => {
    const mfa = await enrolTotp(org.anna.email)
    const base = { email: org.anna.email, password: PW, name: "Phone" }
    const missing = await signIn(base)
    expect(missing.status).toBe(401)
    expect(missing.json.error.code).toBe("mfa_required")
    const wrong = await signIn({ ...base, code: "000000" })
    expect(wrong.status).toBe(401)
    expect(wrong.json.error.code).toBe("invalid_mfa")
    expect(attempts()[0]).toMatchObject({ reason: "mfa_failed", success: false, userId: org.anna.id })
    const ok = await signIn({ ...base, code: await mfa.code() })
    expect(ok.status, JSON.stringify(ok.json)).toBe(201)
    expect((await call(ok.json.token, "GET", "/me")).status).toBe(200)
    expect(attempts()[0]).toMatchObject({ reason: "token_issued", success: true, userId: org.anna.id })
    expect(db.select().from(session).all()).toHaveLength(0)
    const backup = await signIn({ ...base, code: mfa.backupCodes[0] })
    expect(backup.status, JSON.stringify(backup.json)).toBe(201)
    const again = await signIn({ ...base, code: mfa.backupCodes[0] })
    expect(again.status).toBe(401)
    expect(again.json.error.code).toBe("invalid_mfa")
    expect(db.select().from(apikey).all()).toHaveLength(2)
  })

  it("answers 403 mfa_required when the company requires two-factor that is not set up", async () => {
    withSettings({ mfa_required_for_admins: true })
    await setPassword(org.admin.id, PW)
    const r = await signIn({ email: org.admin.email, password: PW, name: "x" })
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe("mfa_required")
    expect(db.select().from(apikey).all()).toHaveLength(0)
    expect((await signIn({ email: org.anna.email, password: PW, name: "x" })).status).toBe(201)
  })

  it("never issues a key for a password alone while two-factor is required, passkey or not", async () => {
    db.insert(passkey)
      .values({
        userId: org.anna.id,
        publicKey: "k",
        credentialID: "c",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      })
      .run()
    withSettings({ mfa_required_for_all: true })
    const r = await signIn({ email: org.anna.email, password: PW, name: "x" })
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe("mfa_required")
  })

  it("throttles after repeated failures like the web sign-in, and floods per address", async () => {
    for (let i = 0; i < 5; i++) {
      // sequential on purpose: the throttle counts the earlier failures
      // oxlint-disable-next-line eslint/no-await-in-loop
      expect((await signIn({ email: org.anna.email, password: "wrong", name: "x" })).status).toBe(401)
    }
    const blocked = await signIn({ email: org.anna.email, password: PW, name: "x" })
    expect(blocked.status).toBe(429)
    expect(blocked.json.error.code).toBe("too_many_requests")
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(attempts()[0].reason).toBe("throttled")
    while (signInBuckets.take("10.0.0.99") === 0) {
      // drain the bucket of another address
    }
    const flood = await signIn(
      { email: org.ben.email, password: PW, name: "x" },
      { "x-resorixtrack-peer": "10.0.0.99" },
    )
    expect(flood.status).toBe(429)
    const other = await signIn(
      { email: org.ben.email, password: "wrong", name: "x" },
      { "x-resorixtrack-peer": "10.0.0.98" },
    )
    expect(other.status).toBe(401)
  })
})

describe("API keys and two-factor", () => {
  it("stop working while the company requires two-factor that the owner has not set up", async () => {
    const key = await keyFor(org.anna.id)
    expect((await call(key, "GET", "/me")).status).toBe(200)
    withSettings({ mfa_required_for_all: true })
    const r = await call(key, "GET", "/me")
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe("mfa_required")
  })

  it("refuses a key without an expiry date (the app never issues one)", async () => {
    const key = await keyFor(org.anna.id)
    db.update(apikey).set({ expiresAt: null }).run()
    expect((await call(key, "GET", "/me")).status).toBe(401)
  })
})
