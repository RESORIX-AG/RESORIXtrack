import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed, tx } from "@/server/middleware"
import {
  createAdjustment,
  deleteAdjustment,
  firstAccountYear,
  setEntitlement,
  statementFrom,
  timeBalance,
  timeStatement,
  vacationAccount,
} from "@/server/services/accounts"
import { overtimeYear } from "@/server/services/compliance"
import { type Actor, canAdjustBalance, dataFrom, requireView } from "@/server/services/permissions"
import { localToday } from "@/server/time"

const id = z.number().int().positive()
const year = z.number().int().min(1990).max(2100)

function target(actor: Actor, userId: number | null | undefined) {
  return userId == null || userId === actor.id ? actor.user : requireView(actor, userId)
}

/** The account page in one call: balance, yearly statement, vacation account, Überzeit tally. */
export const fetchAccount = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish(), year: year.nullish() }))
  .handler(({ data, context: { actor } }) => {
    const user = target(actor, data.userId)
    const y = data.year ?? Number(localToday(user.timezone).slice(0, 4))
    const from = dataFrom(actor, user)
    return {
      user: { id: user.id, name: user.name, timezone: user.timezone },
      year: y,
      /** the year navigation stops here: nothing to show before it */
      firstYear: firstAccountYear(user, from),
      balance: timeBalance(user),
      statement: statementFrom(timeStatement(user, y), from),
      vacation: vacationAccount(user, y),
      overtime: overtimeYear(user, y),
      canAdjust: canAdjustBalance(actor, user),
    }
  })

export const accountQuery = (p: { userId?: number | null; year?: number | null } = {}) =>
  queryOptions({ queryKey: ["account", p.userId ?? null, p.year ?? null], queryFn: () => fetchAccount({ data: p }) })

/** Balance and this year's vacation account (small tiles). */
export const fetchBalance = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(z.object({ userId: id.nullish() }))
  .handler(({ data, context: { actor } }) => {
    const user = target(actor, data.userId)
    return { time: timeBalance(user), vacation: vacationAccount(user, Number(localToday(user.timezone).slice(0, 4))) }
  })

export const balanceQuery = (userId?: number | null) =>
  queryOptions({ queryKey: ["account", "balance", userId ?? null], queryFn: () => fetchBalance({ data: { userId } }) })

export const createAdjustmentFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({
      userId: id,
      account: z.enum(["time", "vacation"]),
      amount: z.number().finite(),
      effectiveDate: z.iso.date().nullish(),
      kind: z.enum(["opening", "payout", "correction"]).default("correction"),
      reason: z.string().min(1).max(500),
    }),
  )
  .handler(({ data: { userId, ...input }, context: { actor } }) => tx(() => createAdjustment(actor, userId, input)))

export const deleteAdjustmentFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, reason: z.string().min(1).max(500) }))
  .handler(({ data, context: { actor } }) => tx(() => deleteAdjustment(actor, data.id, data.reason)))

/** Override the vacation days of one year (`days: null` removes the override). */
export const setEntitlementFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(
    z.object({ userId: id, year, days: z.number().min(0).max(366).nullable(), note: z.string().max(500).default("") }),
  )
  .handler(({ data, context: { actor } }) =>
    tx(() => {
      setEntitlement(actor, data.userId, data.year, data.days, data.note)
      return vacationAccount(requireView(actor, data.userId), data.year)
    }),
  )
