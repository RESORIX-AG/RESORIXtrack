/**
 * Projects people book their time entries on. Company-wide projects (no team) and team projects. Team leads
 * manage the projects of the teams they lead; the `projects` capability manages all of them.
 */
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "../db"
import { type Project, projects, teams, type User } from "../db/schema"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import { iso, utcnow } from "../time"
import { type Actor, canManageProjects } from "./permissions"
import { record, snapshot } from "./revisions"

export interface ProjectView {
  id: number
  name: string
  code: string
  color: string
  description: string
  teamId: number | null
  teamName: string | null
  isActive: boolean
  canManage: boolean
  createdAt: string
}

export interface ProjectInput {
  name?: string
  code?: string
  color?: string
  description?: string
  teamId?: number | null
  isActive?: boolean
}

type Viewer = Pick<Actor, "isHr" | "caps" | "ledTeamIds"> & { user: Pick<User, "teamId"> }

function teamNames(ids: (number | null)[]): Map<number, string> {
  const wanted = [...new Set(ids.filter((x): x is number => x != null))]
  if (!wanted.length) return new Map()
  return new Map(
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, wanted))
      .all()
      .map((t) => [t.id, t.name]),
  )
}

export function serializeProjects(rows: Project[], actor?: Actor): ProjectView[] {
  const names = teamNames(rows.map((p) => p.teamId))
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    color: p.color,
    description: p.description,
    teamId: p.teamId,
    teamName: p.teamId != null ? (names.get(p.teamId) ?? null) : null,
    isActive: p.isActive,
    canManage: actor ? canManageProjects(actor, p.teamId) : false,
    createdAt: iso(p.createdAt),
  }))
}

/**
 * Projects a person may book time on: company-wide ones plus those of their own team and the teams they
 * lead; HR and the projects capability see all.
 */
export function visibleProjects(viewer: Viewer, includeInactive = false): Project[] {
  const conds = []
  if (!(viewer.caps.has("projects") || viewer.isHr)) {
    const ids = new Set(viewer.ledTeamIds)
    if (viewer.user.teamId != null) ids.add(viewer.user.teamId)
    conds.push(ids.size ? or(isNull(projects.teamId), inArray(projects.teamId, [...ids])) : isNull(projects.teamId))
  }
  if (!includeInactive) conds.push(eq(projects.isActive, true))
  return db
    .select()
    .from(projects)
    .where(and(...conds))
    .orderBy(desc(projects.isActive), asc(projects.name))
    .all()
}

export function listProjects(actor: Actor, includeInactive = false): ProjectView[] {
  return serializeProjects(visibleProjects(actor, includeInactive), actor)
}

export function getProjectOr404(id: number): Project {
  const p = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!p) throw new NotFound("Project not found")
  return p
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** Create (no `projectId`) or update a project. */
export function saveProject(actor: Actor, input: ProjectInput, projectId?: number): ProjectView {
  const existing = projectId != null ? getProjectOr404(projectId) : null
  const teamId = input.teamId !== undefined ? input.teamId : (existing?.teamId ?? null)
  if (!canManageProjects(actor, teamId) || (existing && !canManageProjects(actor, existing.teamId))) {
    throw new Forbidden("Team leads manage the projects of their own teams")
  }
  if (teamId != null && !db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).get()) {
    throw new Validation("Unknown team", { fields: { teamId: "invalid" } })
  }
  const name = (input.name ?? existing?.name ?? "").trim().slice(0, 120)
  if (!name) throw new Validation("Project name is required", { fields: { name: "required" } })
  const clash = db.select({ id: projects.id }).from(projects).where(eq(projects.name, name)).get()
  if (clash && clash.id !== existing?.id) {
    throw new Conflict("A project with this name already exists", { code: "project_taken", fields: { name: "taken" } })
  }
  const color = input.color ?? existing?.color ?? "#35a1cc"
  if (!COLOR_RE.test(color)) throw new Validation("Invalid colour", { fields: { color: "invalid" } })
  const values = {
    name,
    teamId,
    code: (input.code ?? existing?.code ?? "").trim().slice(0, 30),
    color,
    description: (input.description ?? existing?.description ?? "").trim().slice(0, 500),
    isActive: input.isActive ?? existing?.isActive ?? true,
  }
  if (!existing) {
    const p = db
      .insert(projects)
      .values({ ...values, createdById: actor.id })
      .returning()
      .get()
    record({ entity: "project", row: p, action: "create", actor, subjectUserId: null, before: null })
    return serializeProjects([p], actor)[0]
  }
  const before = snapshot("project", existing)
  const p = db
    .update(projects)
    .set({ ...values, updatedAt: utcnow() })
    .where(eq(projects.id, existing.id))
    .returning()
    .get()
  if (JSON.stringify(snapshot("project", p)) !== JSON.stringify(before)) {
    record({ entity: "project", row: p, action: "update", actor, subjectUserId: null, before })
  }
  return serializeProjects([p], actor)[0]
}
