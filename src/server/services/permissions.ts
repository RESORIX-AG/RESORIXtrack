/**
 * Who may see and change whose data (port of v1 services/permissions.py).
 *
 * - Employee: own data.
 * - Team lead / deputy (rows in `team_leads`, optionally limited to a period): members of that team –
 *   entries, absences, accounts, corrections, approvals, sign-off, team projects.
 * - HR capability: everyone's time data, reports for all, sign-off of any month, reopening, integrity check.
 * - Administrator (role): users, teams, roles, settings, holidays, branding, backups, logs – but NO time
 *   data of others unless they also hold HR.
 * - Projects capability: creates and maintains all projects.
 *
 * Rule: when an actor may not see a person, behave as if the person does not exist (NotFound), so ids
 * outside the actor's scope are not leaked.
 *
 * A lead or deputy with a start date (cover for a period) sees and changes a member's data from that date on
 * only; a permanent lead (no start date) sees all of it. `dataFrom` gives that first day; services narrow
 * periods to it and answer NotFound for older records. Aggregates (balance, vacation left) stay visible.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db } from "../db"
import { type Capability, type TeamLead, teamLeads, teams, type User, users } from "../db/schema"
import { type AppError, Forbidden, NotFound } from "../errors"
import { localToday } from "../time"
import { getSetting } from "./settings"

export interface Actor {
  user: User
  id: number
  isAdmin: boolean
  isHr: boolean
  caps: ReadonlySet<Capability>
  /** Teams led today (lead or deputy within the period). */
  ledTeamIds: ReadonlySet<number>
  /** Per led team: first day of the members' data the actor may see (null: all, a permanent lead). */
  leadSince: ReadonlyMap<number, string | null>
}

function today(): string {
  return localToday(getSetting("default_timezone"))
}

export function activeLeadRows(opts: { teamId?: number; userId?: number; on?: string } = {}): TeamLead[] {
  const on = opts.on ?? today()
  const conds = [
    or(isNull(teamLeads.validFrom), lte(teamLeads.validFrom, on)),
    or(isNull(teamLeads.validTo), gte(teamLeads.validTo, on)),
  ]
  if (opts.teamId != null) conds.push(eq(teamLeads.teamId, opts.teamId))
  if (opts.userId != null) conds.push(eq(teamLeads.userId, opts.userId))
  return db
    .select()
    .from(teamLeads)
    .where(and(...conds))
    .orderBy(desc(teamLeads.role), asc(teamLeads.id))
    .all()
}

export function ledTeamIds(userId: number): Set<number> {
  return new Set(leadSince(userId).keys())
}

/** Teams led today, each with the earliest start date of the actor's rows for it (no start date wins). */
function leadSince(userId: number): Map<number, string | null> {
  const out = new Map<number, string | null>()
  for (const r of activeLeadRows({ userId })) {
    const prev = out.get(r.teamId)
    if (!out.has(r.teamId)) out.set(r.teamId, r.validFrom)
    else if (prev != null) out.set(r.teamId, r.validFrom == null || r.validFrom < prev ? r.validFrom : prev)
  }
  return out
}

export function actorFromUser(user: User): Actor {
  const caps = new Set<Capability>(user.capabilities ?? [])
  const since = leadSince(user.id)
  return {
    user,
    id: user.id,
    isAdmin: user.role === "admin",
    isHr: caps.has("hr"),
    caps,
    ledTeamIds: new Set(since.keys()),
    leadSince: since,
  }
}

export function getUserOr404(userId: number): User {
  const u = db.select().from(users).where(eq(users.id, userId)).get()
  if (!u) throw new NotFound("User not found")
  return u
}

export function loadActor(userId: number): Actor {
  return actorFromUser(getUserOr404(userId))
}

/** Active leads and deputies of a team (active accounts only). */
export function teamLeaders(teamId: number, on?: string): User[] {
  const ids = activeLeadRows({ teamId, on }).map((r) => r.userId)
  if (!ids.length) return []
  return db
    .select()
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .all()
}

export function leadsUser(actor: Actor, target: User): boolean {
  if (target.teamId == null || target.id === actor.id) return false
  return actor.ledTeamIds.has(target.teamId)
}

/** Time data (entries, absences, accounts, work log, reports) of `target`. */
export function canViewUser(actor: Actor, target: User): boolean {
  return actor.id === target.id || actor.isHr || leadsUser(actor, target)
}

/**
 * First day of `target`'s time data the actor may see or change, for someone `canViewUser` allows: null for
 * the person, HR and permanent leads; the start date for a lead or deputy who covers from a given day.
 */
export function dataFrom(actor: Actor, target: User): string | null {
  if (actor.id === target.id || actor.isHr || target.teamId == null) return null
  return actor.leadSince.get(target.teamId) ?? null
}

/** May the actor see `target`'s data of `date` (YYYY-MM-DD)? */
export function seesDate(actor: Actor, target: User, date: string): boolean {
  const from = dataFrom(actor, target)
  return from == null || date >= from
}

/** `from` moved to the first day the actor may see. */
export function clampFrom(actor: Actor, target: User, from: string): string {
  const first = dataFrom(actor, target)
  return first != null && first > from ? first : from
}

/** A change dated before the actor's cover started. */
export function beforeCover(actor: Actor, target: User): AppError {
  const from = dataFrom(actor, target)
  return new Forbidden(`You can change this person's data from ${from} on`, {
    code: "before_cover",
    fields: { from },
  })
}

/** Refuse a record dated before what the actor may see (as if it did not exist). */
export function requireDate(actor: Actor, target: User, date: string, what = "Record"): void {
  if (!seesDate(actor, target, date)) throw new NotFound(`${what} not found`)
}

/** Profile and contract data (no times): additionally administrators. */
export function canViewProfile(actor: Actor, target: User): boolean {
  return actor.isAdmin || canViewUser(actor, target)
}

export function requireProfile(actor: Actor, userId: number): User {
  const target = getUserOr404(userId)
  if (!canViewProfile(actor, target)) throw new NotFound("User not found")
  return target
}

/** Correct entries, mark sick, approve/cancel absences, log work of `target` (never oneself). */
export function canManageUser(actor: Actor, target: User): boolean {
  if (actor.id === target.id) return false
  return actor.isHr || leadsUser(actor, target)
}

/**
 * Someone else could handle `target`'s time data: another active HR person, or a lead or deputy of their team.
 * When nobody could (the only HR person without a lead), HR acts for themselves rather than getting stuck;
 * the change log shows it like every other change.
 */
export function othersCanManage(target: User): boolean {
  if (hrUsers().some((u) => u.id !== target.id)) return true
  return target.teamId != null && teamLeaders(target.teamId).some((u) => u.id !== target.id)
}

/** HR acting on their own time data: only when nobody else could. */
export function hrSelfFallback(actor: Actor, target: User): boolean {
  return actor.id === target.id && actor.isHr && !othersCanManage(target)
}

/** Another active administrator exists (administrators change each other's rights, never their own). */
export function otherAdminExists(actor: Actor): boolean {
  return (
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, actor.id)))
      .get() != null
  )
}

/**
 * Changes concerning the actor themselves need another administrator, unless there is none. With `hrExempt`,
 * HR may act for themselves (they manage time data anyway).
 */
export function requireSomeoneElse(
  actor: Actor,
  targetUserId: number,
  message: string,
  opts: { hrExempt: boolean },
): void {
  if (targetUserId !== actor.id || (opts.hrExempt && actor.isHr) || !otherAdminExists(actor)) return
  throw new Forbidden(message, { code: "not_for_yourself" })
}

/** An administrator who leads `teamId` adds nobody to it (that would open their time data), unless HR or alone. */
export function ensureNotJoiningOwnTeam(actor: Actor, teamId: number | null): void {
  if (teamId == null || !actor.ledTeamIds.has(teamId)) return
  requireSomeoneElse(actor, actor.id, "Another administrator has to add people to a team you lead", {
    hrExempt: true,
  })
}

/** Schedules and balances of `target` (one's own only as HR when nobody else could). */
export function canEditSchedule(actor: Actor, target: User): boolean {
  if (actor.id === target.id) return hrSelfFallback(actor, target)
  if (actor.isHr) return true
  return leadsUser(actor, target) && getSetting("lead_can_edit_schedules")
}

export function canAdjustBalance(actor: Actor, target: User): boolean {
  if (actor.id === target.id) return hrSelfFallback(actor, target)
  if (actor.isHr) return true
  return leadsUser(actor, target) && getSetting("lead_can_adjust_balances")
}

export function hrUsers(): User[] {
  return db
    .select()
    .from(users)
    .where(
      and(eq(users.isActive, true), sql`exists (select 1 from json_each(${users.capabilities}) where value = 'hr')`),
    )
    .all()
}

/**
 * Who decides on `target`'s requests: the active leads/deputies of their team (never the person themselves);
 * otherwise HR; as a last resort the administrators, so nothing gets stuck.
 */
export function approversFor(target: User): User[] {
  if (target.teamId != null) {
    const team = db.select().from(teams).where(eq(teams.id, target.teamId)).get()
    const leads = team ? teamLeaders(team.id).filter((u) => u.id !== target.id) : []
    if (leads.length) return leads
  }
  const hr = hrUsers().filter((u) => u.id !== target.id)
  if (hr.length) return hr
  return db
    .select()
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
    .all()
    .filter((u) => u.id !== target.id)
}

export const canDecideAbsence = canManageUser

export function canManageProjects(actor: Actor, teamId: number | null): boolean {
  if (actor.caps.has("projects")) return true
  return teamId != null && actor.ledTeamIds.has(teamId)
}

export function requireView(actor: Actor, userId: number): User {
  const target = getUserOr404(userId)
  if (!canViewUser(actor, target)) throw new NotFound("User not found")
  return target
}

export function requireManage(actor: Actor, target: User): void {
  if (!canManageUser(actor, target)) throw new Forbidden("You can only manage members of teams you lead")
}

export function requireAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw new Forbidden("Administrators only")
}

export function requireHr(actor: Actor): void {
  if (!actor.isHr) throw new Forbidden("HR only")
}

/** Ids of people whose time data the actor sees; `null` means everyone (HR). */
export function visibleUserIds(actor: Actor): number[] | null {
  if (actor.isHr) return null
  const ids = new Set<number>([actor.id])
  if (actor.ledTeamIds.size) {
    for (const r of db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.teamId, [...actor.ledTeamIds]))
      .all())
      ids.add(r.id)
  }
  return [...ids].sort((a, b) => a - b)
}

/** Sees the Team section: leads/deputies and HR. */
export function isManager(actor: Actor): boolean {
  return actor.isHr || actor.ledTeamIds.size > 0
}
