/**
 * What time was spent on: a time entry carries a project. The company decides with
 * `project_mode` whether this is off, optional or required; "required" means every finished work entry of a
 * past day has one (checked per day in accounts.computeDays, shown as a warning and blocking the sign-off).
 */
import { and, asc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm"
import { db } from "../db"
import { type Project, projects, timeEntries, type User, userTermsHistory } from "../db/schema"
import { Conflict, Validation } from "../errors"
import { addDays, instantOfMs, localClock, localToday, nowInstant } from "../time"
import { computeDaysFrom, type Day, loadContext, segmentsByDay } from "./accounts"
import { lockedMonths } from "./locks"
import { type Actor, actorFromUser } from "./permissions"
import { getProjectOr404, visibleProjects } from "./projects"
import { getSetting } from "./settings"
import { buildTimeline, dayStartsMs, type EarlierTerms } from "./timeline"

export type ProjectMode = "off" | "optional" | "required"

export function projectMode(): ProjectMode {
  return getSetting("project_mode")
}

/** The project shown on an entry. */
export interface EntryProject {
  id: number
  name: string
  code: string
  color: string
  isActive: boolean
}

export function entryProjects(ids: (number | null)[]): Map<number, EntryProject> {
  const wanted = [...new Set(ids.filter((x): x is number => x != null))]
  if (!wanted.length) return new Map()
  return new Map(
    db
      .select({
        id: projects.id,
        name: projects.name,
        code: projects.code,
        color: projects.color,
        isActive: projects.isActive,
      })
      .from(projects)
      .where(inArray(projects.id, wanted))
      .all()
      .map((p) => [p.id, p]),
  )
}

export interface ProjectFields {
  projectId?: number | null
}

/**
 * The project of a new or changed entry. It must be visible to the owner and active (an inactive one stays on
 * entries that already have it).
 */
export function resolveProjectFields(
  actor: Actor,
  owner: User,
  input: ProjectFields,
  existing: { projectId: number | null } | null,
): { projectId: number | null } {
  const projectId = input.projectId !== undefined ? input.projectId : (existing?.projectId ?? null)
  if (projectId === (existing?.projectId ?? null)) return { projectId }
  if (projectMode() === "off" && projectId != null) {
    throw new Conflict("Projects are switched off", { code: "projects_off" })
  }
  if (projectId != null) checkProject(actor, owner, getProjectOr404(projectId))
  return { projectId }
}

function checkProject(actor: Actor, owner: User, project: Project): void {
  const ownerActor = owner.id === actor.id ? actor : actorFromUser(owner)
  const allowed =
    actor.isHr || actor.caps.has("projects") || visibleProjects(ownerActor, true).some((p) => p.id === project.id)
  if (!allowed)
    throw new Validation("This project is not available for this person", { fields: { projectId: "invalid" } })
  if (!project.isActive) throw new Validation("This project is no longer active", { fields: { projectId: "inactive" } })
}

// ------------------------------------------------------------------ requirement

/** Past days in [start, end] with work that has no project (empty unless projects are required). */
export function daysMissingProjects(user: User, start: string, end: string): string[] {
  if (projectMode() !== "required") return []
  const ctx = loadContext(user, start, end, { includePending: false })
  return computeDaysFrom(ctx, { raw: true })
    .filter((d) => !d.projectOk)
    .map((d) => d.date)
}

export const RECENT_DAYS = 14

/**
 * The oldest of the last 14 days still open for changes whose work lacks a required project. `days` are
 * computed days covering them when the caller has them.
 */
export function firstDayMissingProject(user: User, days?: Pick<Day, "date" | "projectOk">[]): string | null {
  const today = localToday(user.timezone)
  const [start, end] = [addDays(today, -RECENT_DAYS), addDays(today, -1)]
  const missing = days
    ? days.filter((d) => d.date >= start && d.date <= end && !d.projectOk).map((d) => d.date)
    : daysMissingProjects(user, start, end)
  if (!missing.length) return null
  const locked = lockedMonths(user, start, end)
  return missing.find((d) => !locked[d.slice(0, 7)]) ?? null
}

// ------------------------------------------------------------------ project items (reports, coverage)

/** Minutes of one person on one local day spent on a project. */
export interface ProjectItem {
  /** the time entry this piece of a day comes from */
  entryId: number
  userId: number
  date: string
  projectId: number | null
  note: string
  minutes: number
  /** Local HH:MM. */
  start: string | null
  end: string | null
}

const DAY_MS = 86_400_000

/** Earlier terms of several people in one query (the timezone of each day). */
function earlierTermsOf(ids: number[]): Map<number, EarlierTerms[]> {
  const out = new Map<number, EarlierTerms[]>()
  const rows = db
    .select()
    .from(userTermsHistory)
    .where(inArray(userTermsHistory.userId, ids))
    .orderBy(asc(userTermsHistory.userId), asc(userTermsHistory.validUntil))
    .all()
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r])
  return out
}

/**
 * Project time of the people in [from, to] (local days), oldest first: work entries with a project, split into
 * local days as the accounts split them (running ones count until now).
 */
export function projectItems(people: User[], from: string, to: string): ProjectItem[] {
  if (!people.length || to < from) return []
  const n = Temporal.PlainDate.from(from).until(to).days + 1
  const earlier = earlierTermsOf(people.map((u) => u.id))
  const perPerson = new Map(
    people.map((u) => {
      const { tzOn } = buildTimeline(u, earlier.get(u.id))
      return [u.id, { tzOn, starts: dayStartsMs(from, n + 1, tzOn) }]
    }),
  )
  const bounds = [...perPerson.values()].map((p) => p.starts)
  const earliest = bounds.reduce((acc, s) => Math.min(acc, s[0]), Number.POSITIVE_INFINITY)
  const latest = bounds.reduce((acc, s) => Math.max(acc, s[n]), Number.NEGATIVE_INFINITY)
  const rows = db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      startAt: timeEntries.startAt,
      endAt: timeEntries.endAt,
      projectId: timeEntries.projectId,
      note: timeEntries.note,
    })
    .from(timeEntries)
    .where(
      and(
        inArray(
          timeEntries.userId,
          people.map((u) => u.id),
        ),
        eq(timeEntries.isDeleted, false),
        eq(timeEntries.kind, "work"),
        // entries never exceed 24 h, so starting a day earlier catches every entry that reaches into the range
        gte(timeEntries.startAt, instantOfMs(earliest - DAY_MS)),
        lt(timeEntries.startAt, instantOfMs(latest)),
        isNotNull(timeEntries.projectId),
      ),
    )
    .orderBy(timeEntries.startAt)
    .all()
  const now = nowInstant().epochMilliseconds
  const order = new Map(rows.map((r, i) => [r.id, i]))
  const byUser = new Map<number, typeof rows>()
  for (const r of rows) {
    const list = byUser.get(r.userId)
    if (list) list.push(r)
    else byUser.set(r.userId, [r])
  }
  const out: ProjectItem[] = []
  for (const [userId, own] of byUser) {
    const { tzOn, starts } = perPerson.get(userId)!
    for (const [i, segs] of segmentsByDay(own, starts, now).entries()) {
      const date = addDays(from, i)
      const tz = tzOn(date)
      for (const { a, b, e } of segs)
        out.push({
          entryId: e.id,
          userId,
          date,
          projectId: e.projectId,
          note: e.note,
          minutes: (b - a) / 60000,
          start: localClock(a, tz),
          end: b === starts[i + 1] ? "24:00" : localClock(b, tz),
        })
    }
  }
  return out.sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      (x.start ?? "").localeCompare(y.start ?? "") ||
      order.get(x.entryId)! - order.get(y.entryId)!,
  )
}
