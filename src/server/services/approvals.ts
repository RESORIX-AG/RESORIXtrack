/**
 * Approval inbox: the requests the actor decides, with the facts needed to decide (vacation left after
 * approving, who else from the team is away in that period).
 */
import { and, eq, ne } from "drizzle-orm"
import { db } from "../db"
import { type AbsenceStatus, users } from "../db/schema"
import { absenceTypesById, isSensitive } from "./absence-types"
import { absencesInRange, clippedDays, pendingForApprover, serializeAbsences, usersById } from "./absences"
import { vacationAccount } from "./accounts"
import { type Actor, canViewUser, seesDate } from "./permissions"
import { ABSENT_COLOR } from "./team-calendar"

export interface Overlap {
  userId: number
  name: string
  label: string
  typeKey: string
  color: string
  status: AbsenceStatus
  days: number
}

export function pendingApprovals(actor: Actor) {
  const pending = pendingForApprover(actor)
  const dtos = serializeAbsences(actor, pending)
  const types = absenceTypesById()
  const owners = usersById(pending.map((a) => a.userId))
  return dtos.map((dto, i) => {
    const a = pending[i]
    const owner = owners.get(a.userId)!
    const type = types.get(a.typeId)!
    // remainingAfterPending already subtracts this request
    const vacationAfter = type.deductsVacation
      ? vacationAccount(owner, Number(a.startDate.slice(0, 4))).remainingAfterPending
      : null
    return Object.assign(dto, {
      vacationAfter,
      overlaps: teamOverlaps(actor, owner.id, owner.teamId, a.startDate, a.endDate),
    })
  })
}
export type PendingApproval = ReturnType<typeof pendingApprovals>[number]

/** Approved or pending absences of the person's teammates in [from, to]. */
export function teamOverlaps(actor: Actor, userId: number, teamId: number | null, from: string, to: string): Overlap[] {
  if (teamId == null) return []
  const mates = db
    .select()
    .from(users)
    .where(and(eq(users.teamId, teamId), eq(users.isActive, true), ne(users.id, userId)))
    .all()
  if (!mates.length) return []
  const byId = new Map(mates.map((u) => [u.id, u]))
  const types = absenceTypesById()
  const rows = absencesInRange([...byId.keys()], from, to, ["approved", "pending"])
  return rows
    .map((a) => {
      const u = byId.get(a.userId)!
      const t = types.get(a.typeId)!
      const hidden = isSensitive(t.category) && !(canViewUser(actor, u) && seesDate(actor, u, a.endDate))
      return {
        userId: u.id,
        name: u.name,
        label: hidden ? "Absent" : t.label,
        typeKey: hidden ? "absent" : t.key,
        color: hidden ? ABSENT_COLOR : t.color,
        status: a.status,
        days: clippedDays(u, a, from, to),
      }
    })
    .filter((o) => o.days > 0)
}
