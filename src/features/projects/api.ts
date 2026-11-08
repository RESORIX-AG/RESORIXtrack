/** Projects (team projects page, pickers). */
import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed, tx } from "@/server/middleware"
import { canManageProjects } from "@/server/services/permissions"
import { listProjects, saveProject } from "@/server/services/projects"

const id = z.number().int().positive()

export const fetchProjects = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ includeInactive: z.boolean().default(false) }))
  .handler(({ data, context: { actor } }) => ({
    items: listProjects(actor, data.includeInactive),
    canCreate: actor.caps.has("projects") || actor.ledTeamIds.size > 0,
    canCreateCompanyWide: canManageProjects(actor, null),
    teamIds: actor.caps.has("projects") ? null : [...actor.ledTeamIds],
  }))

export const projectsQuery = (includeInactive = false) =>
  queryOptions({ queryKey: ["projects", includeInactive], queryFn: () => fetchProjects({ data: { includeInactive } }) })

const project = {
  name: z.string().min(1).max(120),
  code: z.string().max(30).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  description: z.string().max(500).optional(),
  teamId: id.nullish(),
  isActive: z.boolean().optional(),
}

export const createProjectFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object(project))
  .handler(({ data, context: { actor } }) => tx(() => saveProject(actor, data)))

export const updateProjectFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, ...project, name: project.name.optional() }))
  .handler(({ data: { id: projectId, ...input }, context: { actor } }) =>
    tx(() => saveProject(actor, input, projectId)),
  )
