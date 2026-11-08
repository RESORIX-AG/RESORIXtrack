import { parseArgs } from "node:util"
import { eq } from "drizzle-orm"
import { db } from "@/server/db"
import { session, users } from "@/server/db/schema"
import { env } from "@/server/env"
import { grantBreakGlass } from "@/server/services/break-glass"
import { afterPasswordChanged } from "@/server/services/profile"
import { setPassword } from "@/server/services/user-auth"
import { ask } from "../prompt"

/** Break-glass: set a password from the server shell (also allows one password sign-in while OIDC_ONLY is on). */
export default {
  summary: "set a person's password (break-glass)",
  async run(args: string[]) {
    const { values } = parseArgs({ args, options: { email: { type: "string" }, password: { type: "string" } } })
    if (!values.email) {
      console.error("usage: rt reset-password --email <email> [--password <password>]  (asks when left out)")
      return 1
    }
    const user = db.select().from(users).where(eq(users.email, values.email.trim().toLowerCase())).get()
    if (!user) {
      console.error("no account with this email")
      return 1
    }
    // asked on the terminal by default: a password on the command line ends up in the shell history
    const password = values.password ?? (await ask("New password: ", true))
    await setPassword(user.id, password)
    db.delete(session).where(eq(session.userId, user.id)).run()
    afterPasswordChanged(user.id)
    if (env.oidc.only) {
      const until = grantBreakGlass(user.email)
      console.log(`password sign-in allowed once until ${until}`)
    }
    console.log(`password set for #${user.id} ${user.email}; all sessions and API keys ended`)
    return 0
  },
}
