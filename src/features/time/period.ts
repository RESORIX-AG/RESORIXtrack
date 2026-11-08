import type { PeriodInput } from "./api"

export interface TimeSearch {
  view?: "week" | "month"
  date?: string
  add?: boolean
  deleted?: boolean
  /** "project": mark the work without a project (the dashboard's reminder links here) */
  fix?: "project"
}

export function periodParams(userId: number | null | undefined, s: TimeSearch, today: string): PeriodInput {
  const date = s.date ?? today
  return s.view === "month"
    ? { userId: userId ?? null, month: date.slice(0, 7), includeDeleted: Boolean(s.deleted) }
    : { userId: userId ?? null, week: date, includeDeleted: Boolean(s.deleted) }
}
