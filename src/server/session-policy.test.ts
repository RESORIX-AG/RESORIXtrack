import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { makeUser } from "@/test/factories"
import { auth } from "./auth"
import { db } from "./db"
import { session } from "./db/schema"
import { env } from "./env"
import { setPassword } from "./services/user-auth"

const PW = "correct horse battery"
const HOUR = 3_600_000
const saved = { ...env }

afterEach(() => Object.assign(env, saved))

function cookieOf(res: { headers: Headers }): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((pair) => pair.split("=")[1])
    .join("; ")
}

async function signedIn(rememberMe: boolean) {
  const u = makeUser()
  await setPassword(u.id, PW)
  const res = await auth.api.signInEmail({
    body: { email: u.email, password: PW, rememberMe },
    returnHeaders: true,
    headers: new Headers({ "user-agent": "vitest" }),
  })
  const cookie = cookieOf(res)
  const row = db.select().from(session).where(eq(session.userId, u.id)).get()!
  return { cookie, row, current: () => auth.api.getSession({ headers: new Headers({ cookie }) }) }
}

const age = (id: number, set: { createdAt?: number; updatedAt?: number }) =>
  db
    .update(session)
    .set({
      ...(set.createdAt ? { createdAt: new Date(Date.now() - set.createdAt) } : {}),
      updatedAt: new Date(Date.now() - (set.updatedAt ?? 0)),
    })
    .where(eq(session.id, id))
    .run()
const exists = (id: number) => db.select().from(session).where(eq(session.id, id)).get() != null

describe("session limits", () => {
  it("ends a session without 'keep me signed in' after the idle timeout", async () => {
    const s = await signedIn(false)
    expect(s.cookie).toContain("dont_remember")
    age(s.row.id, { updatedAt: (env.sessionShortIdleHours - 1) * HOUR })
    expect(await s.current()).not.toBeNull()
    // activity slides the idle window
    const slid = db.select().from(session).where(eq(session.id, s.row.id)).get()!
    expect(Date.now() - slid.updatedAt.getTime()).toBeLessThan(60_000)
    expect(slid.expiresAt.getTime()).toBeGreaterThan(Date.now() + (env.sessionShortIdleHours - 1) * HOUR)

    age(s.row.id, { updatedAt: env.sessionShortIdleHours * HOUR + 1000 })
    expect(await s.current()).toBeNull()
    expect(exists(s.row.id)).toBe(false)
  })

  it("keeps the idle timeout when the client leaves out its 'don't remember' cookie", async () => {
    const s = await signedIn(false)
    expect(s.row.short).toBe(true)
    const withoutFlag = s.cookie
      .split("; ")
      .filter((c) => !c.includes("dont_remember"))
      .join("; ")
    age(s.row.id, { updatedAt: env.sessionShortIdleHours * HOUR + 1000 })
    expect(await auth.api.getSession({ headers: new Headers({ cookie: withoutFlag }) })).toBeNull()
    expect(exists(s.row.id)).toBe(false)
  })

  it("keeps an idle remembered session", async () => {
    const s = await signedIn(true)
    expect(s.cookie).not.toContain("dont_remember")
    age(s.row.id, { updatedAt: 5 * 24 * HOUR })
    expect(await s.current()).not.toBeNull()
  })

  it("ends every session after the absolute limit, however active", async () => {
    const remembered = await signedIn(true)
    age(remembered.row.id, { createdAt: env.sessionAbsoluteDays * 24 * HOUR + 1000 })
    expect(await remembered.current()).toBeNull()
    expect(exists(remembered.row.id)).toBe(false)

    Object.assign(env, { sessionAbsoluteDays: 1 })
    const short = await signedIn(false)
    age(short.row.id, { createdAt: 24 * HOUR + 1000, updatedAt: 1000 })
    expect(await short.current()).toBeNull()
  })
})
