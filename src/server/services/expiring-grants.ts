/** One-time permissions kept in app_state until they expire or are used up (break glass, passkey step-up). */
import { eq } from "drizzle-orm"
import { db } from "../db"
import { appState } from "../db/schema"
import { fmtInstant, nowInstant, utcnow } from "../time"

/** Grants `key` for `minutes` from now (replacing an earlier grant); returns when it expires. */
export function grant(key: string, minutes: number): string {
  const until = fmtInstant(nowInstant().add({ minutes }))
  db.insert(appState)
    .values({ key, value: until })
    .onConflictDoUpdate({ target: appState.key, set: { value: until, updatedAt: utcnow() } })
    .run()
  return until
}

export function granted(key: string): boolean {
  const row = db.select().from(appState).where(eq(appState.key, key)).get()
  return Boolean(row && row.value > utcnow())
}

export function revoke(key: string): void {
  db.delete(appState).where(eq(appState.key, key)).run()
}
