import { type QueryClient, queryOptions, useSuspenseQuery } from "@tanstack/react-query"
import type { AnyRouter } from "@tanstack/react-router"
import { type Bootstrap, getBootstrap, type Me } from "@/server/fns/session"

export const bootstrapQuery = queryOptions({
  queryKey: ["bootstrap"],
  queryFn: () => getBootstrap(),
  staleTime: 30_000,
})

export function useBootstrap(): Bootstrap {
  return useSuspenseQuery(bootstrapQuery).data
}

/** The signed-in person (only inside the authenticated app layout). */
export function useMe(): Me {
  const me = useBootstrap().me
  if (!me) throw new Error("useMe() outside the authenticated layout")
  return me
}

/** After you changed your own profile: the shell's data and the route context (language, document title). */
export async function refreshSession(qc: QueryClient, router: Pick<AnyRouter, "invalidate">): Promise<void> {
  await qc.invalidateQueries({ queryKey: ["bootstrap"] })
  await router.invalidate()
}

export type { Bootstrap, Me }
