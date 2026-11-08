/**
 * Data isolation crawler (port of v1 tests/test_isolation.py, extended).
 *
 * Seeds a company with two teams and eight people, each with private data tagged with a marker (time entries,
 * absences incl. a sick note with a document, adjustments, work logs, sign-offs, notifications, API keys,
 * passkeys, sessions). Then every server function under src/features (and src/server/fns) and every REST
 * endpoint is called as each persona, once with the ids of every other person and their records. Asserted:
 *
 *   - no response (result or error) contains markers, names, emails or ids (in id fields) of people outside
 *     the persona's scope; administrators without HR never see time data; sick absences of others are never
 *     identifiable for people who are not the person's lead or HR;
 *   - writes never change rows of people outside the persona's scope (each call runs in a savepoint that is
 *     rolled back afterwards, so calls are independent);
 *   - API keys never see more than their owner (REST crawl with a full-scope key per persona) and never more
 *     than their scopes (a key with a single scope gets 403 everywhere else);
 *   - every server function is classified in SPECS (a new function fails the test until it is added) and
 *     every one is exercised successfully by at least one persona.
 *
 * How server functions are called: without the Start compiler, `.handler(fn)` keeps `fn` only on the client
 * path. The test wraps `createServerFn` so `.handler(fn)` is registered as `.handler(fn, fn)`, exactly what the
 * compiler emits for the server build, and then calls `__executeServer` inside a real Start request scope
 * (`createServerEntry`) with the persona's session cookie. So the real middleware chain (errors, authed with a
 * Better Auth session lookup), the zod validator and the handler run as in production; only the RPC
 * (de)serialisation is skipped.
 */
// The crawl runs every call in its own savepoint on the one connection, and personas get fixed row ids one
// after another, so the awaits in its loops are sequential on purpose.
/* oxlint-disable eslint/no-await-in-loop */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServerEntry } from "@tanstack/react-start/server"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { describeError } from "@/lib/guards"
import { resetTestDb } from "@/test/db"
import { makeCalendar, makeLead, makeSchedule, makeTeam, makeUser } from "@/test/factories"
import { auth } from "./auth"
import { db, rawSqlite } from "./db"
import * as s from "./db/schema"
import { env } from "./env"
import { AppError } from "./errors"
import { hashPassword } from "./password"
import { keyBuckets } from "./rest/auth"
import { type Endpoint, SCOPES } from "./rest/endpoint"
import { ENDPOINTS } from "./rest/endpoints"
import { handleRest } from "./rest/router"
import { ensureDefaultAbsenceTypes } from "./services/absence-types"
import { clearMailOutbox } from "./services/mail"
import { loadActor } from "./services/permissions"
import { updateSettings } from "./services/settings"
import { signOff } from "./services/signoffs"
import { setPasswordHash } from "./services/user-auth"
import { freeze } from "./time"

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@tanstack/react-start")>()
  // biome-ignore lint/suspicious/noExplicitAny: wraps the untyped builder chain
  const wrap = (builder: any): any =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "middleware" || prop === "validator")
          return (...args: unknown[]) => {
            const next = wrap(target[prop](...args))
            if (prop === "validator") next.__validator = args[0]
            else next.__validator = target.__validator
            return next
          }
        if (prop === "handler")
          return (fn: unknown) => {
            const out = target.handler(fn, fn)
            out.__validator = target.__validator
            return out
          }
        return target[prop]
      },
      set(target, prop, value) {
        target[prop] = value
        return true
      },
    })
  return {
    ...mod,
    createServerFn: (...args: unknown[]) => wrap((mod.createServerFn as (...a: unknown[]) => unknown)(...args)),
  }
})

// ------------------------------------------------------------------ the company

type Key = "anna" | "ben" | "carl" | "lea" | "dora" | "hanna" | "ada" | "hugo" | "tina"
const KEYS: Key[] = ["anna", "ben", "carl", "lea", "dora", "hanna", "ada", "hugo", "tina"]
const PERSONAS: Key[] = ["anna", "carl", "lea", "dora", "hanna", "ada", "hugo", "tina"]

const PEOPLE: Record<Key, { name: string; team?: "A" | "B"; role?: "admin"; hr?: boolean }> = {
  anna: { name: "Anna Muster", team: "A" }, // employee
  ben: { name: "Ben Beispiel", team: "A" }, // her colleague
  carl: { name: "Carl Other", team: "B" }, // other team's employee
  lea: { name: "Lea Lead", team: "A" }, // lead of team A
  dora: { name: "Dora Deputy" }, // deputy of team B, but only in 2025
  hanna: { name: "Hanna HR", hr: true },
  ada: { name: "Ada Admin", role: "admin" }, // administrator without HR
  hugo: { name: "Hugo Admin", role: "admin", hr: true }, // administrator with HR
  tina: { name: "Tina Temporary" }, // deputy of team B from 2026-10-15: Carl's data from that day on
}

/** A lead or deputy with a start date sees a member's data from that day on only. */
const COVER_FROM = "2026-10-15"
const PARTIAL: Partial<Record<Key, Key>> = { tina: "carl" }

/** Whose time data a persona may see. */
const TIME_SCOPE: Record<Key, Key[] | "all"> = {
  anna: ["anna"],
  ben: ["ben"],
  carl: ["carl"],
  lea: ["lea", "anna", "ben"],
  dora: ["dora"],
  hanna: "all",
  ada: ["ada"],
  hugo: "all",
  tina: ["tina", "carl"],
}
/** Whose name, email and user id a persona may see (own team calendar, user administration). */
const PEOPLE_SCOPE: Record<Key, Key[] | "all"> = {
  anna: ["anna", "ben", "lea"],
  ben: ["anna", "ben", "lea"],
  carl: ["carl"],
  lea: ["lea", "anna", "ben"],
  dora: ["dora"],
  hanna: "all",
  ada: "all",
  hugo: "all",
  tina: ["tina", "carl"],
}
/** HR acts on everyone's data (signs months off), so her name appears legitimately everywhere. */
const ACTORS = new Set<Key>(["hanna", "hugo"])

const inScope = (scope: Key[] | "all", k: Key) => scope === "all" || scope.includes(k)
const timeMarker = (k: Key) => `ZQ${k.toUpperCase()}`
const accountMarker = (k: Key) => `ZK${k.toUpperCase()}`
const PW = "crawler passphrase 2026"

interface Seeded {
  user: s.User
  base: number
  teamId: number | null
  entries: number[]
  vacation: number
  sick: number
  attachment: number
  /** Carl only: a sick day before Tina's cover started, with its document */
  oldSick?: number
  oldAttachment?: number
  adjustment: number
  notification: number
  schedule: number
  signoff: number
  session: number
  apikey: number
  passkey: number
  account: number
  leadRows: number[]
  cookie: string
  key: string
}

const P = {} as Record<Key, Seeded>
let teams: { A: s.Team; B: s.Team }
let fixed: { calendar: number; holiday: number; absenceType: number; project: number }
let dir: string
const savedEnv = { ...env }

function cookieOf(res: { headers: Headers }): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ")
}

async function seed() {
  resetTestDb()
  freeze("2026-11-05T08:00:00Z")
  updateSettings({ setup_complete: true })
  const cal = makeCalendar({}, [{ date: "2026-12-25", name: "Christmas" }])
  ensureDefaultAbsenceTypes()
  teams = { A: makeTeam({ name: "Team A" }), B: makeTeam({ name: "Team B" }) }
  const project = db.insert(s.projects).values({ name: "Probe project", teamId: teams.A.id }).returning().get()
  const types = db.select().from(s.absenceTypes).all()
  const vacationType = types.find((t) => t.key === "vacation")!
  const sickType = types.find((t) => t.key === "sick")!
  fixed = {
    calendar: cal.id,
    holiday: db.select().from(s.holidays).get()!.id,
    absenceType: vacationType.id,
    project: project.id,
  }
  const hash = await hashPassword(PW)
  KEYS.forEach((k, i) => {
    const spec = PEOPLE[k]
    const id = 1001 + i
    const user = makeUser({
      id,
      name: spec.name,
      email: `${k}@example.nomail`,
      teamId: spec.team ? teams[spec.team].id : null,
      role: spec.role ?? "employee",
      capabilities: spec.hr ? ["hr"] : [],
    })
    setPasswordHash(id, hash)
    P[k] = { user, base: (i + 1) * 10000, teamId: user.teamId } as Seeded
  })
  P.lea.leadRows = [makeLead(teams.A.id, P.lea.user.id).id]
  P.dora.leadRows = [
    makeLead(teams.B.id, P.dora.user.id, { role: "deputy", validFrom: "2025-01-01", validTo: "2025-12-31" }).id,
  ]
  P.tina.leadRows = [
    makeLead(teams.B.id, P.tina.user.id, { role: "deputy", validFrom: COVER_FROM, validTo: "2026-12-31" }).id,
  ]
  for (const k of KEYS) {
    const p = P[k]
    const uid = p.user.id
    const b = p.base
    const m = timeMarker(k)
    p.leadRows ??= []
    p.schedule = makeSchedule(uid, { id: b + 601 }).id
    makeSchedule(uid, { id: b + 602, validFrom: "2026-10-01" }) // changeable: after the signed-off September
    p.entries = [
      db
        .insert(s.timeEntries)
        .values({
          id: b + 1,
          userId: uid,
          startAt: "2026-09-07T07:00:00Z",
          endAt: "2026-09-07T15:00:00Z",
          note: `${m}-sept`,
          source: "manual",
        })
        .returning()
        .get().id,
      db
        .insert(s.timeEntries)
        .values({
          id: b + 2,
          userId: uid,
          startAt: "2026-11-02T07:00:00Z",
          endAt: "2026-11-02T15:24:00Z",
          note: `${m}-entry`,
          source: "manual",
        })
        .returning()
        .get().id,
      db
        .insert(s.timeEntries)
        .values({
          id: b + 4,
          userId: uid,
          startAt: "2026-10-05T07:00:00Z",
          endAt: "2026-10-05T15:00:00Z",
          note: `${m}-october`,
          source: "manual",
        })
        .returning()
        .get().id,
    ]
    p.vacation = db
      .insert(s.absences)
      .values({
        id: b + 101,
        userId: uid,
        typeId: vacationType.id,
        startDate: "2026-12-14",
        endDate: "2026-12-15",
        status: "pending",
        note: `${m}-vacation`,
      })
      .returning()
      .get().id
    p.sick = db
      .insert(s.absences)
      .values({
        id: b + 102,
        userId: uid,
        typeId: sickType.id,
        startDate: "2026-11-03",
        endDate: "2026-11-03",
        status: "approved",
        note: `${m}-sick`,
      })
      .returning()
      .get().id
    p.attachment = db
      .insert(s.attachments)
      .values({
        id: b + 201,
        absenceId: p.sick,
        filename: `${m}-zeugnis.pdf`,
        contentType: "application/pdf",
        size: 10,
        sha256: "x",
        storageName: `${k}-doc`,
        uploadedById: uid,
      })
      .returning()
      .get().id
    if (k === "carl") {
      p.oldSick = db
        .insert(s.absences)
        .values({
          id: b + 103,
          userId: uid,
          typeId: sickType.id,
          startDate: "2026-10-06",
          endDate: "2026-10-06",
          status: "approved",
          note: `${m}-oldsick`,
        })
        .returning()
        .get().id
      p.oldAttachment = db
        .insert(s.attachments)
        .values({
          id: b + 202,
          absenceId: p.oldSick,
          filename: `${m}-oldnote.pdf`,
          contentType: "application/pdf",
          size: 10,
          sha256: "x",
          storageName: `${k}-olddoc`,
          uploadedById: uid,
        })
        .returning()
        .get().id
    }
    p.adjustment = db
      .insert(s.balanceAdjustments)
      .values({
        id: b + 301,
        userId: uid,
        account: "time",
        amount: 60,
        effectiveDate: "2026-10-01",
        reason: `${m}-adjustment`,
      })
      .returning()
      .get().id
    p.notification = db
      .insert(s.notifications)
      .values({ id: b + 801, userId: uid, kind: "clock_reminder", payload: { hours: 10, marker: `${m}-notification` } })
      .returning()
      .get().id
    p.passkey = db
      .insert(s.passkey)
      .values({
        id: b + 901,
        name: `${accountMarker(k)}-passkey`,
        publicKey: "x",
        userId: uid,
        credentialID: `${k}-cred`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      })
      .returning()
      .get().id
    rawSqlite()
      .prepare("UPDATE account SET id = ? WHERE user_id = ?")
      .run(b + 951, uid)
    p.account = b + 951
    const signer = k === "hanna" ? P.hugo.user : P.hanna.user
    p.signoff = signOff(loadActor(signer.id), p.user, "2026-09", `${m}-signoff`).id
    if (k === "hugo")
      db.insert(s.timeEntries)
        .values({ id: b + 3, userId: uid, startAt: "2026-11-05T07:00:00Z", endAt: null })
        .run()
    const res = await auth.api.signInEmail({
      body: { email: p.user.email, password: PW },
      returnHeaders: true,
      headers: new Headers({ "user-agent": `${accountMarker(k)}-agent` }),
    })
    p.cookie = cookieOf(res)
    p.session = b + 701
    rawSqlite().prepare("UPDATE session SET id = ? WHERE user_id = ?").run(p.session, uid)
    const permissions = { time: ["read", "write"], absences: ["read", "write"], reports: ["read"] }
    const created = await auth.api.createApiKey({
      body: { userId: String(uid), name: `${accountMarker(k)}-key`, permissions },
    })
    p.key = created.key
    p.apikey = b + 751
    rawSqlite().prepare("UPDATE apikey SET id = ? WHERE id = ?").run(p.apikey, Number(created.id))
  }
  clearMailOutbox()
}

// ------------------------------------------------------------------ scope checks

interface Hidden {
  markers: string[]
  names: string[]
  ids: Set<number>
  timeUsers: number[]
  otherUsers: number[]
}

function hiddenFor(persona: Key): Hidden {
  const markers: string[] = []
  const names: string[] = []
  const ids = new Set<number>()
  const timeUsers: number[] = []
  for (const k of KEYS) {
    if (k === persona) continue
    const p = P[k]
    const seesTime = inScope(TIME_SCOPE[persona], k)
    const seesPerson = inScope(PEOPLE_SCOPE[persona], k)
    // sessions, keys, passkeys, sign-ins: the person and administrators (security logs) only
    if (PEOPLE[persona].role !== "admin") {
      markers.push(accountMarker(k))
      for (const id of [p.session, p.apikey, p.passkey, p.account]) ids.add(id)
    }
    if (!seesTime) {
      timeUsers.push(p.user.id)
      markers.push(timeMarker(k))
      for (const id of [...p.entries, p.sick, p.attachment, p.adjustment, p.notification]) ids.add(id)
      if (p.oldSick) ids.add(p.oldSick).add(p.oldAttachment!)
      // a colleague's (non-sensitive) vacation shows in the own team calendar
      if (!seesPerson) ids.add(p.vacation)
    }
    if (PARTIAL[persona] === k) {
      // dated before the cover started: September and October entries, the October adjustment, the sign-off
      const m = timeMarker(k)
      markers.push(`${m}-sept`, `${m}-october`, `${m}-adjustment`, `${m}-signoff`, `${m}-oldsick`, `${m}-oldnote`)
      for (const id of [p.entries[0], p.entries[2], p.adjustment, p.oldSick!, p.oldAttachment!]) ids.add(id)
    }
    if (!seesPerson && !ACTORS.has(k)) {
      names.push(p.user.name, p.user.email)
      ids.add(p.user.id)
    }
  }
  return {
    markers,
    names,
    ids,
    timeUsers,
    otherUsers: KEYS.filter((k) => k !== persona).map((k) => P[k].user.id),
  }
}

const ID_KEY = /(^id$|Id$|Ids$|^ids$)/

/** Numbers sent by the caller: echoing them back (e.g. "not found: 1003") reveals nothing. */
function numbersIn(v: unknown, out = new Set<number>()): Set<number> {
  if (typeof v === "number") out.add(v)
  else if (typeof v === "string" && /^\d+$/.test(v)) out.add(Number(v))
  else if (v instanceof FormData) for (const [, x] of v) numbersIn(x, out)
  else if (v && typeof v === "object") for (const x of Object.values(v)) numbersIn(x, out)
  return out
}

function leaks(h: Hidden, value: unknown, sent: Set<number> = new Set()): string[] {
  const text = typeof value === "string" ? value : stringify(value)
  const found = [...h.markers, ...h.names].filter((m) => text.includes(m))
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, key)
      return
    }
    if (typeof v === "number" && ID_KEY.test(key) && h.ids.has(v) && !sent.has(v)) found.push(`${key}=${v}`)
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  if (typeof value !== "string") walk(value, "")
  return found
}

function stringify(v: unknown): string {
  return (
    JSON.stringify(v, (_k, x) => {
      if (x instanceof Map) return Object.fromEntries(x)
      if (x instanceof Set) return [...x]
      if (x instanceof Uint8Array) return new TextDecoder("latin1").decode(x)
      if (x instanceof Error) return { message: x.message, ...(x as unknown as Record<string, unknown>) }
      return x
    }) ?? ""
  )
}

const TIME_TABLES = [
  "SELECT * FROM time_entries WHERE user_id IN (%) ORDER BY id",
  "SELECT * FROM absences WHERE user_id IN (%) ORDER BY id",
  "SELECT * FROM attachments WHERE absence_id IN (SELECT id FROM absences WHERE user_id IN (%)) ORDER BY id",
  "SELECT * FROM balance_adjustments WHERE user_id IN (%) ORDER BY id",
  "SELECT * FROM month_signoffs WHERE user_id IN (%) ORDER BY id",
  "SELECT * FROM vacation_entitlements WHERE user_id IN (%) ORDER BY id",
]
const ACCOUNT_TABLES = [
  "SELECT id, email, name, role, team_id, is_active, capabilities, timezone, locale, employment_start, employment_end FROM users WHERE id IN (%) ORDER BY id",
  "SELECT * FROM work_schedules WHERE user_id IN (%) ORDER BY id",
  "SELECT * FROM team_leads WHERE user_id IN (%) ORDER BY id",
  "SELECT id, name, enabled, expires_at, permissions FROM apikey WHERE reference_id IN (%) ORDER BY id",
  "SELECT id, token, expires_at FROM session WHERE user_id IN (%) ORDER BY id",
  "SELECT id, password FROM account WHERE user_id IN (%) ORDER BY id",
  "SELECT * FROM passkey WHERE user_id IN (%) ORDER BY id",
]

const rowsOf = (sqlText: string, ids: number[]) =>
  ids.length
    ? rawSqlite()
        .prepare(sqlText.replace("%", ids.map(() => "?").join(",")))
        .all(...(sqlText.includes("reference_id") ? ids.map(String) : ids))
    : []

const one = (table: string, id: number) => rawSqlite().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)

/** Rows a persona must never change: others' time data outside scope; for non-admins also others' accounts. */
function fingerprint(persona: Key, h: Hidden): string {
  const out: unknown[] = TIME_TABLES.map((t) => rowsOf(t, h.timeUsers))
  const partial = PARTIAL[persona]
  if (partial) {
    const p = P[partial]
    out.push(
      one("time_entries", p.entries[0]),
      one("time_entries", p.entries[2]),
      one("balance_adjustments", p.adjustment),
      one("month_signoffs", p.signoff),
      one("absences", p.oldSick!),
      one("attachments", p.oldAttachment!),
    )
  }
  if (PEOPLE[persona].role !== "admin") {
    const others = h.otherUsers.filter((id) => !inScope(TIME_SCOPE[persona], keyOf(id)))
    out.push(...ACCOUNT_TABLES.map((t) => rowsOf(t, others)))
  }
  return JSON.stringify(out)
}

const keyOf = (userId: number): Key => KEYS.find((k) => P[k].user.id === userId)!

// ------------------------------------------------------------------ probes

type RecordKind =
  | "user"
  | "entry"
  | "absence"
  | "attachment"
  | "adjustment"
  | "signoff"
  | "schedule"
  | "session"
  | "apikey"
  | "passkey"
  | "account"
  | "notification"
  | "lead"
  | "team"
  | "calendar"
  | "holiday"
  | "absenceType"
  | "project"

function records(t: Key, kind: RecordKind): number[] {
  const p = P[t]
  switch (kind) {
    case "user":
      return [p.user.id]
    case "entry":
      return p.entries
    case "absence":
      return [p.sick, p.vacation, ...(p.oldSick ? [p.oldSick] : [])]
    case "attachment":
      return [p.attachment, ...(p.oldAttachment ? [p.oldAttachment] : [])]
    case "lead":
      return p.leadRows
    case "team":
      return p.teamId != null ? [p.teamId] : []
    case "calendar":
    case "holiday":
    case "absenceType":
    case "project":
      return [fixed[kind]]
    default:
      return [p[kind]]
  }
}

/** Values by field name; the first one the field's schema accepts wins. */
function candidates(field: string, t: Key, rec: number): unknown[] {
  const p = P[t]
  switch (field) {
    case "id":
      return [rec]
    case "ids":
      return [[rec]]
    case "userId":
    case "memberId":
      return [p.user.id]
    case "userIds":
    case "memberIds":
      return [[p.user.id]]
    case "teamId":
      return [p.teamId ?? teams.B.id]
    case "scheduleId":
      return [p.schedule + 1]
    case "entryId":
      return [p.entries[1]]
    case "absenceId":
      return [p.sick]
    case "calendarId":
      return [fixed.calendar]
    case "projectId":
      return [undefined]
    case "from":
      return ["2026-10-01"]
    case "to":
      return ["2026-12-31"]
    case "date":
    case "day":
    case "week":
      return ["2026-11-04"]
    case "startDate":
      return ["2026-12-21"]
    case "endDate":
      return ["2026-12-22"]
    case "startAt":
      return ["2026-11-04T13:00:00Z"]
    case "endAt":
      return ["2026-11-04T14:00:00Z"]
    case "year":
      return [2026]
    case "years":
      return [[2026]]
    case "month":
      return ["2026-10", 10]
    case "q":
      return [p.user.name.split(" ")[0]]
    case "reason":
    case "note":
    case "message":
    case "decisionNote":
      return ["probe reason"]
    case "password":
    case "adminPassword":
    case "currentPassword":
      return ["wrong probe password"]
    case "newPassword":
      return ["another probe passphrase 77"]
    case "type":
      return ["vacation"]
    case "account":
      return ["time"]
    case "amount":
      return [30]
    case "approve":
      return [true]
    case "action":
      return ["start"]
    case "name":
    case "label":
      return ["Probe"]
    case "email":
      return ["probe@example.nomail"]
    case "timezone":
      return ["Europe/Zurich"]
    case "country":
      return ["CH"]
    case "minutes":
      return [60]
    case "status":
      return ["all", ["pending", "approved"]]
    default:
      return []
  }
}

// biome-ignore lint/suspicious/noExplicitAny: zod internals are walked structurally
type Z = any
const ok = (schema: Z, v: unknown) => schema.safeParse(v).success

function generic(schema: Z, t: Key = "anna", rec = 0): unknown[] {
  const def = schema?._zod?.def ?? schema?.def
  switch (def?.type) {
    case "optional":
    case "default":
    case "prefault":
      return [undefined, ...generic(def.innerType, t, rec)]
    case "nullable":
      return [null, ...generic(def.innerType, t, rec)]
    case "pipe":
      return generic(def.in, t, rec)
    case "string":
      return ["probe", "2026-11-04", "#35a1cc", "09:00", "2026-10", "probe@example.nomail", "Europe/Zurich", "dark"]
    case "number":
    case "int":
      return [1, 60, 2026, 10, 0.5, 45, 100]
    case "boolean":
      return [false, true]
    case "enum":
      return Object.values(def.entries)
    case "literal":
      return def.values
    case "array":
      return [
        [],
        ...generic(def.element, t, rec)
          .slice(0, 1)
          .map((x) => [x]),
      ]
    case "union":
      return def.options.flatMap((o: Z) => generic(o, t, rec))
    case "object":
      return [build(schema, t, rec)]
    case "record":
      return [{}]
    default:
      return [undefined]
  }
}

function probeValue(schema: Z, field: string, t: Key, rec: number): unknown {
  const def = schema?._zod?.def
  let inner = schema
  while (["optional", "default", "nullable", "prefault"].includes(inner?._zod?.def?.type))
    inner = inner._zod.def.innerType
  if (inner?._zod?.def?.type === "object") return build(inner, t, rec)
  for (const c of [...candidates(field, t, rec), ...generic(schema, t, rec)]) if (ok(schema, c)) return c
  return def ? undefined : undefined
}

/** A plausible input for an object schema, aimed at person `t` and record `rec`. */
function build(schema: Z, t: Key, rec: number): Record<string, unknown> {
  let obj = schema
  while (obj?._zod?.def?.type === "pipe") obj = obj._zod.def.in
  const shape = obj?.shape ?? {}
  const out: Record<string, unknown> = {}
  for (const [field, fieldSchema] of Object.entries(shape)) {
    const v = probeValue(fieldSchema, field, t, rec)
    if (v !== undefined) out[field] = v
  }
  return out
}

// ------------------------------------------------------------------ server functions

interface Spec {
  /** What `id` (and `ids`) refers to; default: a person. */
  id?: RecordKind
  /** Custom input instead of the generated one. */
  data?: (t: Key, rec: number) => unknown
  /** Why no persona can call it successfully in this setup. */
  noSuccess?: string
}

const SPECS: Record<string, Spec> = {
  "features/absences/api#fetchAbsenceTypes": {},
  "features/absences/api#fetchAbsences": {},
  "features/absences/api#fetchAbsence": { id: "absence" },
  "features/absences/api#fetchAbsenceHistory": { id: "absence" },
  "features/absences/api#fetchSickCheck": {},
  "features/absences/api#fetchAbsencePreview": {},
  "features/absences/api#createAbsenceFn": {},
  "features/absences/api#reportSickTodayFn": {},
  "features/absences/api#updateAbsenceFn": { id: "absence" },
  "features/absences/api#decideAbsenceFn": { id: "absence" },
  "features/absences/api#cancelAbsenceFn": { id: "absence" },
  "features/absences/api#uploadAttachmentFn": {
    id: "absence",
    data: (_t, rec) => {
      const f = new FormData()
      f.set("absenceId", String(rec))
      f.set("file", new File([new Uint8Array([37, 80, 68, 70, 45])], "probe.pdf", { type: "application/pdf" }))
      return f
    },
  },
  "features/absences/api#deleteAttachmentFn": { id: "attachment" },
  "features/absences/api#fetchAbsenceOverview": {},
  "features/absences/api#fetchCalendarDays": {
    data: (t) => ({ userId: P[t].user.id, from: "2026-11-01", to: "2026-12-31" }),
  },
  "features/accounts/api#fetchAccount": {},
  "features/accounts/api#fetchBalance": {},
  "features/accounts/api#createAdjustmentFn": {},
  "features/accounts/api#deleteAdjustmentFn": { id: "adjustment" },
  "features/accounts/api#setEntitlementFn": {},
  "features/admin/api/api-keys#fetchAllApiKeys": {},
  "features/admin/api/api-keys#revokeApiKeyAdminFn": { id: "apikey" },
  "features/admin/api/holidays#fetchCalendars": {},
  "features/admin/api/holidays#fetchCalendarYear": { id: "calendar" },
  "features/admin/api/holidays#fetchHolidayCatalog": {},
  "features/admin/api/holidays#saveCalendarFn": {
    id: "calendar",
    data: (_t, rec) => ({
      id: rec,
      name: "Probe",
      regionCode: "CH-ZH",
      presetDays: [],
      description: "",
      isDefault: false,
    }),
  },
  "features/admin/api/holidays#setDefaultCalendarFn": { id: "calendar" },
  "features/admin/api/holidays#deleteCalendarFn": { id: "calendar" },
  "features/admin/api/holidays#saveHolidayFn": { id: "holiday" },
  "features/admin/api/holidays#deleteHolidayFn": { id: "holiday" },
  "features/admin/api/holidays#importHolidaysFn": {
    id: "calendar",
    data: (_t, rec) => ({ calendarId: rec, preset: "CH-ZH", presetDays: [], year: 2026, replace: false }),
  },
  "features/admin/api/holidays#fetchCompanyDays": { id: "calendar" },
  "features/admin/api/holidays#addCompanyDayFn": {
    id: "calendar",
    data: (_t, rec) => ({ calendarId: rec, key: "dec31_pm", year: 2026 }),
  },
  "features/admin/api/logs#fetchBackups": {},
  "features/admin/api/logs#createBackupFn": {},
  "features/admin/api/logs#deleteBackupFn": { noSuccess: "no backup files exist in the test data dir" },
  "features/admin/api/logs#fetchAudit": {},
  "features/admin/api/logs#fetchLogins": {},
  "features/admin/api/settings#fetchAdminSettings": {},
  "features/admin/api/settings#saveSettingsFn": { data: () => ({ changes: { company_name: "Probe AG" } }) },
  "features/admin/api/settings#uploadLogoFn": {
    data: () => ({
      variant: "dark",
      dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64"),
    }),
  },
  "features/admin/api/settings#deleteLogoFn": {},
  "features/admin/api/settings#setAccentFn": {},
  "features/admin/api/settings#sendTestMailFn": { noSuccess: "SMTP is not configured in tests" },
  "features/admin/api/settings#fetchAbsenceTypesAdmin": {},
  "features/admin/api/settings#saveAbsenceTypeFn": {
    id: "absenceType",
    // the vacation type is in use: its counting stays as it is
    data: () => ({
      id: fixed.absenceType,
      key: "vacation",
      input: {
        label: "Probe",
        color: "#35a1cc",
        category: "vacation",
        creditsTime: true,
        deductsVacation: true,
        requiresApproval: true,
        allowsAttachments: false,
        employeeCanRequest: true,
        isActive: true,
        sort: 10,
      },
    }),
  },
  "features/admin/api/settings#patchAbsenceTypeFn": { id: "absenceType" },
  "features/admin/api/settings#deleteAbsenceTypeFn": { id: "absenceType", noSuccess: "built-in types are in use" },
  "features/admin/api/settings#fetchGettingStarted": {},
  "features/admin/api/settings#dismissGettingStartedFn": {},
  "features/admin/api/teams#fetchTeams": {},
  "features/admin/api/teams#saveTeamFn": { id: "team" },
  "features/admin/api/teams#deleteTeamFn": { id: "team" },
  "features/admin/api/teams#addLeadFn": {},
  "features/admin/api/teams#updateLeadFn": { id: "lead" },
  "features/admin/api/teams#removeLeadFn": { id: "lead" },
  "features/admin/api/users#fetchUsers": {},
  "features/admin/api/users#fetchUserDetail": {},
  "features/admin/api/users#fetchUserHistory": {},
  "features/admin/api/users#fetchUserRefs": {},
  "features/admin/api/users#createUserFn": {},
  "features/admin/api/users#updateUserFn": {},
  "features/admin/api/users#setActiveFn": {},
  "features/admin/api/users#rehireFn": {
    data: (_t, rec) => ({ id: rec, start: "2027-01-01" }),
    noSuccess: "no seeded person has an employment end",
  },
  "features/admin/api/users#resendInviteFn": { noSuccess: "every seeded person already has a password" },
  "features/admin/api/users#setPasswordFn": { noSuccess: "the admin password probe is wrong on purpose" },
  "features/admin/api/users#resetMfaFn": { noSuccess: "the admin password probe is wrong on purpose" },
  "features/admin/api/users#removePasskeysFn": { noSuccess: "the admin password probe is wrong on purpose" },
  "features/admin/api/users#anonymizeFn": { noSuccess: "the admin password probe is wrong on purpose" },
  "features/admin/api/users#exportUserFn": {},
  "features/admin/api/users#setEntitlementFn": {},
  "features/admin/api/users#saveScheduleFn": {},
  "features/admin/api/users#deleteScheduleFn": {},
  "features/auth/api#fetchAuthConfig": {},
  "features/auth/api#fetchPrivacyNotice": {},
  "features/auth/api#fetchSetupInfo": {},
  "features/auth/api#runSetup": { noSuccess: "setup is complete" },
  "features/auth/api#fetchInviteInfo": { noSuccess: "no invitation token exists" },
  "features/auth/api#acceptInvitation": { noSuccess: "no invitation token exists" },
  "features/compliance/api#fetchFindings": {},
  "features/compliance/api#fetchYearFindings": {},
  "features/compliance/api#fetchTeamCompliance": {},
  "features/holidays/api#fetchMyHolidays": {},
  "features/notifications/api#fetchNotifications": {},
  "features/notifications/api#markNotificationsRead": { id: "notification" },
  "features/profile/api#fetchProfile": {},
  "features/profile/api#saveProfile": {},
  "features/profile/api#changePassword": { noSuccess: "the current password probe is wrong on purpose" },
  "features/profile/api#fetchSecurity": {},
  "features/profile/api#unlinkSignInProvider": { id: "account", noSuccess: "the password sign-in cannot be removed" },
  "features/profile/api#fetchSessions": {},
  "features/profile/api#endSession": { id: "session" },
  "features/profile/api#endOtherSessions": {},
  "features/profile/api#fetchApiKeys": {},
  "features/profile/api#createApiKey": { noSuccess: "the password probe is wrong on purpose" },
  "features/profile/api#deleteApiKey": { id: "apikey" },
  "features/profile/api#fetchLoginHistory": {},
  "features/profile/api#fetchPasskeys": {},
  "features/profile/api#confirmPasskeyRegistration": { noSuccess: "the password probe is wrong on purpose" },
  "features/profile/api#renameOwnPasskey": { id: "passkey" },
  "features/profile/api#deleteOwnPasskey": { id: "passkey" },
  "features/reports/api#fetchTimesheet": {},
  "features/reports/api#fetchBalancesReport": {},
  "features/reports/api#fetchAbsencesReport": {},
  "features/reports/api#fetchProjectHours": {},
  "features/reports/api#fetchRawEntries": {},
  "features/reports/api#fetchComplianceReport": {},
  "features/search/api#searchFn": {},
  "features/signoff/api#fetchSignoffOverview": {},
  "features/signoff/api#fetchSignoffs": {},
  "features/signoff/api#fetchSignoff": { id: "signoff" },
  "features/signoff/api#signOffFn": {},
  // HR reopens someone else's month (never their own)
  "features/signoff/api#reopenFn": {
    id: "signoff",
    data: (t) => ({ id: P[t === "hanna" || t === "hugo" ? "carl" : t].signoff, reason: "probe reason" }),
  },
  "features/signoff/api#verifySignoffsFn": {},
  "features/team/api#fetchTeamOverview": {},
  "features/team/api#fetchTeamCalendar": {},
  "features/team/api#fetchMember": {},
  "features/team/api#fetchApprovals": {},
  "features/team/api#fetchTeamScope": {},
  "features/team/api#fetchMemberSchedules": {},
  "features/team/api#fetchAdjustments": {},
  "features/time/api#fetchPeriod": { data: (t) => ({ userId: P[t].user.id, month: "2026-11", includeDeleted: true }) },
  "features/time/api#fetchTimeOverview": {},
  "features/time/api#createEntryFn": {},
  "features/time/api#updateEntryFn": { id: "entry" },
  "features/time/api#deleteEntryFn": { id: "entry" },
  "features/time/api#restoreEntryFn": { id: "entry" },
  "features/time/api#disputeEntryFn": { id: "entry", noSuccess: "no entry was corrected by someone else" },
  "features/time/api#fetchEntryHistory": { id: "entry" },
  "features/time/api#fetchUserHistory": {},
  "features/time/api#fetchClock": {},
  "features/time/api#clockActionFn": {},
  "features/time/api#syncOfflineFn": {
    data: () => ({ actions: [{ id: "probe-1", action: "start", at: "2026-11-05T07:00:00Z" }] }),
  },
  "features/time/api#fetchCorrections": { id: "entry" },
  "features/projects/api#fetchProjects": {},
  "features/projects/api#createProjectFn": {},
  "features/projects/api#updateProjectFn": { id: "project" },
  "features/apidocs/api#fetchApiDocs": {},
  "server/fns/session#getBootstrap": {},
}

/** Writes whose effect on others' time data is intended. */
const SIDE_EFFECTS: Record<string, string> = {
  "features/admin/api/users#setActiveFn": "deactivating an account closes its running entry (logged)",
}

// biome-ignore lint/suspicious/noExplicitAny: server function objects carry internal fields
type ServerFn = any

const modules = {
  ...import.meta.glob("/src/features/**/api.ts"),
  ...import.meta.glob("/src/features/**/api/*.ts"),
  ...import.meta.glob("/src/server/fns/*.ts"),
}

async function serverFns(): Promise<Map<string, ServerFn>> {
  const out = new Map<string, ServerFn>()
  const loaded = await Promise.all(Object.entries(modules).map(async ([file, load]) => [file, await load()] as const))
  for (const [file, loadedModule] of loaded) {
    const mod = loadedModule as Record<string, unknown>
    const base = file.replace(/^\/src\//, "").replace(/\.ts$/, "")
    for (const [name, v] of Object.entries(mod))
      if (typeof v === "function" && typeof (v as ServerFn).__executeServer === "function")
        out.set(`${base}#${name}`, v)
  }
  return out
}

const startStorage = (globalThis as Record<symbol, { run: <T>(ctx: unknown, fn: () => T) => T }>)[
  Symbol.for("tanstack-start:start-storage-context")
]

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown }

async function callFn(fn: ServerFn, data: unknown, cookie: string): Promise<Outcome> {
  let out: { result?: unknown; error?: unknown } | undefined
  const request = new Request("http://localhost:3210/_serverFn/crawl", {
    method: fn.method ?? "POST",
    headers: { cookie, "user-agent": "crawler", "x-resorixtrack-peer": "10.9.9.9" },
  })
  const entry = createServerEntry({
    fetch: async (req: Request) => {
      out = await startStorage.run(
        { request: req, startOptions: {}, contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        () => fn.__executeServer({ data, method: fn.method }),
      )
      return new Response(null)
    },
  })
  await entry.fetch(request)
  if (!out) return { ok: false, error: new Error("no result") }
  if ("error" in out && out.error !== undefined) return { ok: false, error: out.error }
  let value = out.result
  if (value instanceof Response) value = await value.text()
  return { ok: true, value }
}

const codeOf = (r: Outcome) => (r.ok ? "ok" : r.error instanceof AppError ? r.error.code : "unexpected")

function errorView(e: unknown) {
  return e instanceof AppError
    ? { code: e.code, status: e.status, message: e.message, fields: e.fields }
    : { code: "unexpected", message: describeError(e) }
}

// ------------------------------------------------------------------ harness

function inSavepoint<T>(fn: () => Promise<T>): Promise<T> {
  rawSqlite().exec("SAVEPOINT crawl")
  return fn().finally(() => {
    rawSqlite().exec("ROLLBACK TO crawl")
    rawSqlite().exec("RELEASE crawl")
  })
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "rt-crawl-"))
  Object.assign(env, {
    dataDir: dir,
    backupsDir: path.join(dir, "backups"),
    attachmentsDir: path.join(dir, "attachments"),
    brandingDir: path.join(dir, "branding"),
    backupPassword: "crawl-backup-password",
  })
})

afterAll(() => {
  Object.assign(env, savedEnv)
  rmSync(dir, { recursive: true, force: true })
  freeze(null)
})

// src/test/setup.ts resets the database before every test, so each test seeds the company itself

describe("isolation", () => {
  it("every server function is classified and leaks nothing to any persona", async () => {
    await seed()
    const fns = await serverFns()
    const unclassified = [...fns.keys()].filter((k) => !(k in SPECS))
    expect(unclassified, "add these server functions to SPECS in isolation.test.ts").toEqual([])
    const stale = Object.keys(SPECS).filter((k) => !fns.has(k))
    expect(stale, "remove these entries from SPECS").toEqual([])

    const problems: string[] = []
    const succeeded = new Set<string>()
    const lastError = new Map<string, string>()
    const crashes: string[] = []
    let calls = 0
    for (const persona of PERSONAS) {
      const h = hiddenFor(persona)
      const before = fingerprint(persona, h)
      const targets: Key[] = TIME_SCOPE[persona] === "all" ? [persona] : KEYS
      for (const [name, fn] of fns) {
        const spec = SPECS[name]
        const validator = fn.__validator
        const seen = new Set<string>()
        for (const t of targets) {
          for (const rec of records(t, spec.id ?? "user")) {
            const data = spec.data
              ? spec.data(t, rec)
              : validator && typeof validator === "object"
                ? build(validator, t, rec)
                : undefined
            const sig = data instanceof FormData ? `form:${rec}` : JSON.stringify(data ?? null)
            if (seen.has(sig)) continue
            seen.add(sig)
            if (validator && typeof validator === "object" && !(data instanceof FormData) && !ok(validator, data))
              continue
            calls++
            await inSavepoint(async () => {
              const r = await callFn(fn, data, P[persona].cookie)
              const shown = r.ok ? r.value : errorView(r.error)
              if (r.ok) succeeded.add(name)
              else if (!(r.error instanceof AppError))
                crashes.push(`${persona} ${name} ${stringify(data)}: ${errorView(r.error).message}`)
              else lastError.set(name, `${persona} ${sig.slice(0, 160)}: ${r.error.code} ${r.error.message}`)
              const found = leaks(h, shown, numbersIn(data))
              if (found.length) problems.push(`${persona} -> ${name}(${sig.slice(0, 120)}) leaks ${found.join(", ")}`)
              if (fn.method === "POST" && !SIDE_EFFECTS[name] && fingerprint(persona, h) !== before)
                problems.push(`${persona} -> ${name}(${sig.slice(0, 120)}) changed data outside their scope`)
            })
          }
        }
      }
      clearMailOutbox()
    }
    console.info(`[isolation] ${calls} server function calls`)
    expect(problems).toEqual([])
    expect(crashes).toEqual([])
    const never = [...fns.keys()]
      .filter((k) => !succeeded.has(k) && !SPECS[k].noSuccess)
      .map((k) => `${k} (${lastError.get(k) ?? "probe never passed the validator"})`)
    expect(never, "never called successfully: fix the probe in SPECS").toEqual([])
    expect(calls).toBeGreaterThan(1000)
  }, 600_000)

  it("administrator step-ups ask for the own password only when the administrator has one", async () => {
    await seed()
    const fns = await serverFns()
    const call = (name: string, data: unknown, k: Key) =>
      callFn(fns.get(`features/admin/api/users#${name}`), data, P[k].cookie)
    const anna = P.anna.user.id

    // with a password: empty or wrong is rejected, the right one passes
    expect(await call("fetchUserRefs", undefined, "hugo")).toMatchObject({ ok: true, value: { stepUpPassword: true } })
    for (const adminPassword of ["", "wrong probe password"])
      expect(codeOf(await inSavepoint(() => call("removePasskeysFn", { id: anna, adminPassword }, "hugo")))).toBe(
        "invalid_admin_password",
      )
    expect(await inSavepoint(() => call("removePasskeysFn", { id: anna, adminPassword: PW }, "hugo"))).toMatchObject({
      ok: true,
      value: { removed: 1 },
    })

    // single sign-on only (no credential row, session still valid): no password to confirm
    await inSavepoint(async () => {
      db.delete(s.account).where(eq(s.account.userId, P.ada.user.id)).run()
      expect(await call("fetchUserRefs", undefined, "ada")).toMatchObject({
        ok: true,
        value: { stepUpPassword: false },
      })
      expect(await call("removePasskeysFn", { id: anna, adminPassword: "" }, "ada")).toMatchObject({
        ok: true,
        value: { removed: 1 },
      })
      // past the step-up: the service answers that Anna has no second factor
      expect(codeOf(await call("resetMfaFn", { id: anna, adminPassword: "" }, "ada"))).toBe("mfa_disabled")
      // employees never get past the role check, password or not
      db.delete(s.account).where(eq(s.account.userId, P.carl.user.id)).run()
      expect(codeOf(await call("removePasskeysFn", { id: anna, adminPassword: "" }, "carl"))).toBe("forbidden")
    })
  }, 120_000)

  it("REST: full-scope keys see nothing outside their owner's scope", async () => {
    await seed()
    const problems: string[] = []
    const succeeded = new Set<string>()
    let calls = 0
    for (const persona of PERSONAS) {
      const h = hiddenFor(persona)
      const before = fingerprint(persona, h)
      for (const ep of ENDPOINTS) {
        const seen = new Set<string>()
        for (const t of KEYS) {
          for (const rec of restRecords(ep, t)) {
            const req = restRequest(ep, t, rec, P[persona].key)
            if (seen.has(req.sig)) continue
            seen.add(req.sig)
            calls++
            keyBuckets.reset()
            await inSavepoint(async () => {
              const res = await handleRest(req.request)
              const text = await res.text()
              if (res.status < 300) succeeded.add(`${ep.method} ${ep.path}`)
              if (res.status >= 500) problems.push(`${persona} -> ${req.sig} crashed: ${text}`)
              const found = leaks(h, text ? JSON.parse(text) : null, req.sent)
              if (found.length) problems.push(`${persona} -> ${req.sig} leaks ${found.join(", ")}`)
              if (ep.method !== "GET" && fingerprint(persona, h) !== before)
                problems.push(`${persona} -> ${req.sig} changed data outside their scope`)
            })
          }
        }
      }
    }
    expect(problems).toEqual([])
    const never = ENDPOINTS.map((e) => `${e.method} ${e.path}`).filter((k) => !succeeded.has(k) && !REST_NO_SUCCESS[k])
    expect(never).toEqual([])
    expect(calls).toBeGreaterThan(300)
  }, 300_000)

  it("REST: a key never exceeds its scopes", async () => {
    await seed()
    for (const scope of SCOPES) {
      const [res, action] = scope.split(":")
      const created = await auth.api.createApiKey({
        body: { userId: String(P.hugo.user.id), name: "single", permissions: { [res]: [action] } },
      })
      for (const ep of ENDPOINTS) {
        if (!ep.scope || ep.scope === scope) continue
        for (const t of ["hugo", "anna"] as Key[]) {
          const rec = restRecords(ep, t)[0] ?? 1
          keyBuckets.reset()
          const r = await inSavepoint(() => handleRest(restRequest(ep, t, rec, created.key).request))
          expect(r.status, `${scope} key: ${ep.method} ${ep.path}`).toBe(403)
        }
      }
    }
  }, 120_000)
})

const REST_NO_SUCCESS: Record<string, string> = { "POST /auth/token": "signs in with a password, not a key" }

function restRecords(ep: Endpoint, t: Key): number[] {
  if (!ep.path.includes("{id}")) return [0]
  return ep.path.startsWith("/entries") ? P[t].entries : [P[t].sick, P[t].vacation]
}

function restRequest(ep: Endpoint, t: Key, rec: number, key: string) {
  const query = ep.query ? build(ep.query, t, rec) : {}
  const qs = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)]),
  ).toString()
  const urlPath = ep.path.replace("{id}", String(rec))
  const body = ep.body ? build(ep.body, t, rec) : undefined
  const sig = `${ep.method} ${urlPath}?${qs} ${body ? JSON.stringify(body) : ""}`
  const sent = numbersIn([rec, query, body])
  const request = new Request(`http://localhost/api/v1${urlPath}${qs ? `?${qs}` : ""}`, {
    method: ep.method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { request, sig, sent }
}
