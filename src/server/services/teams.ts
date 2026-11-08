/**
 * Teams (port of v1 services/users.py, team part): name, colour, holiday calendar, members, and leads and
 * deputies with optional validity periods. Administrators only.
 */
import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "../db"
import { holidayCalendars, type Team, type TeamLead, teamLeads, teams, users } from "../db/schema"
import { Conflict, NotFound, Validation } from "../errors"
import { notify } from "./notifications"
import { type Actor, activeLeadRows, ensureNotJoiningOwnTeam, requireAdmin, requireSomeoneElse } from "./permissions"
import { record, snapshot } from "./revisions"
import { archiveFromToday, inheritingCalendar } from "./terms"
import { logLeadChange } from "./users"

const COLOR_RE = /^#[0-9a-f]{6}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface TeamInput {
  name: string
  color: string
  holidayCalendarId: number | null
}

export interface LeadInput {
  userId: number
  role: "lead" | "deputy"
  validFrom: string | null
  validTo: string | null
}

export function listTeams(actor: Actor) {
  requireAdmin(actor)
  const rows = db
    .select({ t: teams, calendar: holidayCalendars.name })
    .from(teams)
    .leftJoin(holidayCalendars, eq(holidayCalendars.id, teams.holidayCalendarId))
    .orderBy(asc(teams.name))
    .all()
  const leads = db
    .select({ r: teamLeads, name: users.name, isActive: users.isActive })
    .from(teamLeads)
    .innerJoin(users, eq(users.id, teamLeads.userId))
    .orderBy(desc(teamLeads.role), asc(teamLeads.validFrom), asc(teamLeads.id)) // "lead" before "deputy"
    .all()
  const active = new Set(activeLeadRows().map((r) => r.id))
  const members = db
    .select({ id: users.id, name: users.name, teamId: users.teamId })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name))
    .all()
  return rows.map(({ t, calendar }) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    holidayCalendarId: t.holidayCalendarId,
    calendarName: calendar,
    leads: leads
      .filter((l) => l.r.teamId === t.id)
      .map((l) => ({
        id: l.r.id,
        userId: l.r.userId,
        name: l.name,
        role: l.r.role,
        validFrom: l.r.validFrom,
        validTo: l.r.validTo,
        active: active.has(l.r.id) && l.isActive,
      })),
    members: members.filter((m) => m.teamId === t.id).map((m) => ({ id: m.id, name: m.name })),
  }))
}
export type TeamRow = ReturnType<typeof listTeams>[number]

function getTeam(teamId: number): Team {
  const t = db.select().from(teams).where(eq(teams.id, teamId)).get()
  if (!t) throw new NotFound("Team not found")
  return t
}

function validateTeam(input: Partial<TeamInput>, exceptId?: number) {
  const fields: Record<string, string> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) fields.name = "required"
    else if (name.length > 120) fields.name = "too_long"
    else {
      const clash = db.select({ id: teams.id }).from(teams).where(eq(teams.name, name)).get()
      if (clash && clash.id !== exceptId) fields.name = "taken"
    }
  }
  if (input.color !== undefined && !COLOR_RE.test(input.color)) fields.color = "invalid"
  if (
    input.holidayCalendarId != null &&
    !db
      .select({ id: holidayCalendars.id })
      .from(holidayCalendars)
      .where(eq(holidayCalendars.id, input.holidayCalendarId))
      .get()
  )
    fields.holidayCalendarId = "invalid"
  if (Object.keys(fields).length) throw new Validation("Please check your input", { fields })
}

export function createTeam(actor: Actor, input: TeamInput): Team {
  requireAdmin(actor)
  validateTeam(input)
  return db
    .insert(teams)
    .values({ name: input.name.trim(), color: input.color || "#35a1cc", holidayCalendarId: input.holidayCalendarId })
    .returning()
    .get()
}

export function updateTeam(actor: Actor, teamId: number, input: Partial<TeamInput>): Team {
  requireAdmin(actor)
  const t = getTeam(teamId)
  validateTeam(input, t.id)
  const next: Partial<Team> = {}
  if (input.name !== undefined) next.name = input.name.trim()
  if (input.color !== undefined) next.color = input.color
  if (input.holidayCalendarId !== undefined && input.holidayCalendarId !== t.holidayCalendarId) {
    // members without their own calendar switch from today; earlier days keep the old one
    archiveFromToday(inheritingCalendar(t.id))
    next.holidayCalendarId = input.holidayCalendarId
  }
  return Object.keys(next).length ? db.update(teams).set(next).where(eq(teams.id, t.id)).returning().get() : t
}

/** Members keep all their data and become team-less; lead rows go with the team (logged). */
export function deleteTeam(actor: Actor, teamId: number): void {
  requireAdmin(actor)
  const t = getTeam(teamId)
  const members = db.select().from(users).where(eq(users.teamId, t.id)).all()
  archiveFromToday(members)
  for (const u of members) {
    const before = snapshot("user", u)
    const row = db.update(users).set({ teamId: null }).where(eq(users.id, u.id)).returning().get()
    record({
      entity: "user",
      row,
      action: "update",
      actor,
      subjectUserId: u.id,
      before,
      reason: `Team ${t.name} deleted`,
    })
  }
  for (const r of db.select().from(teamLeads).where(eq(teamLeads.teamId, t.id)).all()) logLeadChange(actor, r, "delete")
  db.delete(teams).where(eq(teams.id, t.id)).run()
}

/** Make exactly `userIds` the (active) members of the team; people moved in leave their old team. */
export function setMembers(actor: Actor, teamId: number, userIds: number[]): void {
  requireAdmin(actor)
  const t = getTeam(teamId)
  const wanted = new Set(userIds)
  const affected = db
    .select()
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        or(eq(users.teamId, t.id), userIds.length ? inArray(users.id, userIds) : undefined),
      ),
    )
    .all()
  const known = new Set(affected.map((u) => u.id))
  const unknown = userIds.filter((id) => !known.has(id))
  if (unknown.length) throw new Validation("Unknown person", { fields: { userIds: "invalid" } })
  if (affected.some((u) => wanted.has(u.id) && u.teamId !== t.id)) ensureNotJoiningOwnTeam(actor, t.id)
  for (const u of affected) {
    const target = wanted.has(u.id) ? t.id : null
    if (u.teamId === target) continue
    // the team (and its calendar) changes from today; earlier days keep the old one
    archiveFromToday([u])
    const before = snapshot("user", u)
    const row = db.update(users).set({ teamId: target }).where(eq(users.id, u.id)).returning().get()
    record({ entity: "user", row, action: "update", actor, subjectUserId: u.id, before })
  }
}

function validateLead(input: LeadInput): void {
  const fields: Record<string, string> = {}
  const u = db.select().from(users).where(eq(users.id, input.userId)).get()
  if (!u?.isActive) fields.userId = "invalid"
  if (input.role !== "lead" && input.role !== "deputy") fields.role = "invalid"
  if (input.validFrom && !DAY_RE.test(input.validFrom)) fields.validFrom = "invalid"
  if (input.validTo && !DAY_RE.test(input.validTo)) fields.validTo = "invalid"
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) fields.validTo = "before_start"
  if (Object.keys(fields).length) throw new Validation("Please check your input", { fields })
}

function ensureNoDuplicate(teamId: number, input: LeadInput, exceptId?: number) {
  const dup = db
    .select({ id: teamLeads.id })
    .from(teamLeads)
    .where(
      and(
        eq(teamLeads.teamId, teamId),
        eq(teamLeads.userId, input.userId),
        eq(teamLeads.role, input.role),
        input.validFrom ? eq(teamLeads.validFrom, input.validFrom) : isNull(teamLeads.validFrom),
        input.validTo ? eq(teamLeads.validTo, input.validTo) : isNull(teamLeads.validTo),
      ),
    )
    .all()
    .filter((r) => r.id !== exceptId)
  if (dup.length)
    throw new Conflict("This person already has that role for this team in that period", { code: "lead_exists" })
}

export function addLead(actor: Actor, teamId: number, input: LeadInput): TeamLead {
  requireAdmin(actor)
  requireSomeoneElse(actor, input.userId, "Another administrator has to make you a lead", { hrExempt: true })
  const t = getTeam(teamId)
  validateLead(input)
  ensureNoDuplicate(t.id, input)
  const row = db
    .insert(teamLeads)
    .values({
      teamId: t.id,
      userId: input.userId,
      role: input.role,
      validFrom: input.validFrom || null,
      validTo: input.validTo || null,
      createdById: actor.id,
    })
    .returning()
    .get()
  logLeadChange(actor, row, "create")
  notify(input.userId, "lead_assigned", {
    team: t.name,
    role: row.role,
    actor_name: actor.user.name,
    valid_from: row.validFrom,
    valid_to: row.validTo,
  })
  return row
}

export function updateLead(
  actor: Actor,
  leadId: number,
  input: Pick<LeadInput, "role" | "validFrom" | "validTo">,
): TeamLead {
  requireAdmin(actor)
  const row = db.select().from(teamLeads).where(eq(teamLeads.id, leadId)).get()
  if (!row) throw new NotFound("Lead not found")
  requireSomeoneElse(actor, row.userId, "Another administrator has to change your lead role", { hrExempt: true })
  const merged = {
    userId: row.userId,
    role: input.role,
    validFrom: input.validFrom || null,
    validTo: input.validTo || null,
  }
  validateLead(merged)
  ensureNoDuplicate(row.teamId, merged, row.id)
  const before = { team_id: row.teamId, role: row.role, valid_from: row.validFrom, valid_to: row.validTo }
  const updated = db
    .update(teamLeads)
    .set({ role: merged.role, validFrom: merged.validFrom, validTo: merged.validTo })
    .where(eq(teamLeads.id, row.id))
    .returning()
    .get()
  logLeadChange(actor, updated, "update", before)
  return updated
}

export function removeLead(actor: Actor, leadId: number): void {
  requireAdmin(actor)
  const row = db.select().from(teamLeads).where(eq(teamLeads.id, leadId)).get()
  if (!row) throw new NotFound("Lead not found")
  logLeadChange(actor, row, "delete")
  db.delete(teamLeads).where(eq(teamLeads.id, row.id)).run()
}

export function teamCount(): number {
  return db.select({ n: count() }).from(teams).get()?.n ?? 0
}
