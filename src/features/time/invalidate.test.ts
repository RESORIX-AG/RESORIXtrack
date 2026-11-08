import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import type { PeriodView } from "./api"
import { dropEntry } from "./invalidate"

const view = (ids: number[]) => ({ entries: ids.map((id) => ({ id, deleted: false })) }) as unknown as PeriodView

describe("dropEntry", () => {
  it("removes a deleted entry from cached views, or marks it where deleted entries are shown", () => {
    const qc = new QueryClient()
    const plain = ["time", "period", { week: "2026-11-02", includeDeleted: false }]
    const withDeleted = ["time", "period", { week: "2026-11-02", includeDeleted: true }]
    qc.setQueryData(plain, view([1, 2]))
    qc.setQueryData(withDeleted, view([1, 2]))
    dropEntry(qc, 1)
    expect(qc.getQueryData<PeriodView>(plain)?.entries.map((e) => e.id)).toEqual([2])
    expect(qc.getQueryData<PeriodView>(withDeleted)?.entries.map((e) => [e.id, e.deleted])).toEqual([
      [1, true],
      [2, false],
    ])
  })
})
