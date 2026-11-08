import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm"
import { db } from "@/server/db"
import { balanceAdjustments, teams, users } from "@/server/db/schema"
import { serializeAdjustment } from "@/server/services/accounts"
import { type Actor, clampFrom, isManager, requireView } from "@/server/services/permissions"
import { scopeUsers } from "@/server/services/signoffs"
import { localToday } from "@/server/time"

/**
 * Pickers for team views and reports. People: everyone whose time data the actor sees, including leavers of
 * the last two years (reports of past months). Teams: HR and the projects capability see all teams, leads the
 * teams they lead, employees none.
 */
export function teamScope(actor: Actor) {
  const year = Number(localToday(actor.user.timezone).slice(0, 4))
  const people = isManager(actor) ? scopeUsers(actor, { periodStart: `${year - 1}-01-01` }) : [actor.user]
  const all = actor.isHr || actor.caps.has("projects")
  const led = [...actor.ledTeamIds]
  const q = db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams)
  const teamRows = all
    ? q.orderBy(asc(teams.name)).all()
    : led.length
      ? q.where(inArray(teams.id, led)).orderBy(asc(teams.name)).all()
      : []
  return {
    today: localToday(actor.user.timezone),
    people: people.map((u) => ({ id: u.id, name: u.name, teamId: u.teamId, isActive: u.isActive })),
    teams: teamRows,
  }
}
export type TeamScope = ReturnType<typeof teamScope>

/**
 * All balance adjustments of a person in a year, both accounts, including today's and future-dated ones
 * (the yearly statement only lists those up to yesterday). Same visibility as the account.
 */
export function yearAdjustments(actor: Actor, userId: number, year: number) {
  const user = requireView(actor, userId)
  return db
    .select({ a: balanceAdjustments, name: users.name })
    .from(balanceAdjustments)
    .leftJoin(users, eq(users.id, balanceAdjustments.createdById))
    .where(
      and(
        eq(balanceAdjustments.userId, user.id),
        eq(balanceAdjustments.isDeleted, false),
        gte(balanceAdjustments.effectiveDate, clampFrom(actor, user, `${year}-01-01`)),
        lte(balanceAdjustments.effectiveDate, `${year}-12-31`),
      ),
    )
    .orderBy(desc(balanceAdjustments.effectiveDate), desc(balanceAdjustments.id))
    .all()
    .map((r) => serializeAdjustment({ ...r.a, createdByName: r.name }))
}
