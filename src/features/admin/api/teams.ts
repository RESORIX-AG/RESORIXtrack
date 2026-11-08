import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed, tx } from "@/server/middleware"
import {
  addLead,
  createTeam,
  deleteTeam,
  listTeams,
  removeLead,
  setMembers,
  updateLead,
  updateTeam,
} from "@/server/services/teams"

const id = z.number().int().positive()
const day = z.iso.date()
const teamInput = z.object({
  name: z.string().max(120),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  holidayCalendarId: id.nullable(),
})
const leadInput = z.object({ role: z.enum(["lead", "deputy"]), validFrom: day.nullable(), validTo: day.nullable() })

export const fetchTeams = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => listTeams(actor))

export const saveTeamFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id: id.nullable(), input: teamInput, memberIds: z.array(id).max(5000) }))
  .handler(({ data, context: { actor } }) =>
    tx(() => {
      const team = data.id ? updateTeam(actor, data.id, data.input) : createTeam(actor, data.input)
      setMembers(actor, team.id, data.memberIds)
      return { id: team.id }
    }),
  )

export const deleteTeamFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    tx(() => deleteTeam(actor, data.id))
    return { ok: true }
  })

export const addLeadFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(leadInput.extend({ teamId: id, userId: id }))
  .handler(({ data, context: { actor } }) => {
    const { teamId, ...input } = data
    return { id: tx(() => addLead(actor, teamId, input)).id }
  })

export const updateLeadFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(leadInput.extend({ id }))
  .handler(({ data, context: { actor } }) => {
    const { id: leadId, ...input } = data
    tx(() => updateLead(actor, leadId, input))
    return { ok: true }
  })

export const removeLeadFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    tx(() => removeLead(actor, data.id))
    return { ok: true }
  })

export const teamsQuery = queryOptions({ queryKey: ["admin", "teams"], queryFn: () => fetchTeams() })
