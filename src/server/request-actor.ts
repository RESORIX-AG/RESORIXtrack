/**
 * The signed-in person of a plain HTTP route (downloads), under the same rules as the `authed` middleware:
 * an active account, and two-factor set up where the company requires it. Null otherwise.
 */
import { auth } from "./auth"
import { mfaEnrolmentDue } from "./services/mfa-policy"
import { type Actor, loadActor } from "./services/permissions"

export async function requestActor(headers: Headers): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  const actor = loadActor(Number(session.user.id))
  return actor.user.isActive && !mfaEnrolmentDue(actor.user) ? actor : null
}
