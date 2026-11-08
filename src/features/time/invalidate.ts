import type { QueryClient } from "@tanstack/react-query"
import type { PeriodView } from "./api"

/** Everything that derives from time entries (views, clock, balances, findings). */
export function invalidateTimeData(qc: QueryClient): Promise<unknown> {
  return Promise.all(
    [["time"], ["clock"], ["account"], ["compliance"], ["absences"]].map((queryKey) =>
      qc.invalidateQueries({ queryKey }),
    ),
  )
}

/** A deleted entry leaves the cached week and month views at once (or shows as deleted where those are shown). */
export function dropEntry(qc: QueryClient, id: number): void {
  for (const [key, view] of qc.getQueriesData<PeriodView>({ queryKey: ["time", "period"] })) {
    if (!view) continue
    const params = key[2]
    const showDeleted =
      typeof params === "object" && params !== null && "includeDeleted" in params && params.includeDeleted
    const entries = showDeleted
      ? view.entries.map((e) => (e.id === id ? { ...e, deleted: true } : e))
      : view.entries.filter((e) => e.id !== id)
    qc.setQueryData<PeriodView>(key, { ...view, entries })
  }
}
