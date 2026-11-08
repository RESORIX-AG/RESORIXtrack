/**
 * Server-function middleware.
 *
 *   createServerFn({ method: "POST" })
 *     .middleware([authed])
 *     .validator(zodSchema)
 *     .handler(({ data, context: { actor } }) => tx(() => service(actor, data)))
 *
 * - `errors`: converts anything thrown into an AppError (code/status/message/fields reach the client;
 *   unexpected errors are logged and become a generic `server_error`).
 * - `authed`: requires a Better Auth session, loads the Actor (roles, capabilities, led teams). While the
 *   company requires two-factor authentication and the person has not set it up, only `authedEnrolment`
 *   functions (the profile) answer.
 * - `optionalAuth`: like `authed` but `actor` may be null (public pages).
 */
import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { auth } from "./auth"
import { rawSqlite } from "./db"
import { AppError, Forbidden, toAppError, Unauthorized } from "./errors"
import { mfaEnrolmentDue } from "./services/mfa-policy"
import { type Actor, loadActor } from "./services/permissions"

export const errors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next()
  } catch (err) {
    const e = toAppError(err)
    if (!(err instanceof AppError) && e.code === "server_error") console.error("[server fn]", err)
    throw e
  }
})

const sessionActor = createServerOnlyFn(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) return null
  const actor = loadActor(Number(session.user.id))
  return actor.user.isActive ? actor : null
})

/** Signed in, but two-factor setup may still be due: the profile (password, two-factor, passkeys, devices). */
export const authedEnrolment = createMiddleware({ type: "function" })
  .middleware([errors])
  .server(async ({ next }) => {
    const actor = await sessionActor()
    if (!actor) throw new Unauthorized("Please sign in")
    return next({ context: { actor } })
  })

export const authed = createMiddleware({ type: "function" })
  .middleware([errors])
  .server(async ({ next }) => {
    const actor = await sessionActor()
    if (!actor) throw new Unauthorized("Please sign in")
    if (mfaEnrolmentDue(actor.user))
      throw new Forbidden("Set up two-factor authentication first", { code: "mfa_enrolment_required" })
    return next({ context: { actor } })
  })

export const optionalAuth = createMiddleware({ type: "function" })
  .middleware([errors])
  .server(async ({ next }) => next({ context: { actor: await sessionActor() } }))

/**
 * Run `fn` in one SQLite transaction (synchronous; nested calls become savepoints). Services use the
 * global `db`; because better-sqlite3 has a single connection, all their statements join the transaction.
 * Never `await` inside.
 */
export const tx: <T>(fn: () => T) => T = createServerOnlyFn(<T>(fn: () => T): T => rawSqlite().transaction(fn)())
