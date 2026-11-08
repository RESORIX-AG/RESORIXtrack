/**
 * The project chosen for the next clock-in, kept per person in this browser until that clock-in (or the
 * clock-out) uses it up, so nothing from an earlier session is preselected; the server keeps nothing. With
 * projects required, a clock-in without one is refused in the browser and flags the picker
 * (`useProjectPrompt`) until a project is chosen.
 */
import { useSyncExternalStore } from "react"

const key = (userId: number) => `rt.clock.project.${userId}`
const subs = new Set<() => void>()
// used when storage is blocked: the choice then lasts until the page reloads
const memory = new Map<number, number | null>()
let prompted = false

export function readNextProject(userId: number): number | null {
  if (memory.has(userId)) return memory.get(userId) ?? null
  try {
    const v = Number(localStorage.getItem(key(userId)))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export function writeNextProject(userId: number, projectId: number | null): void {
  try {
    if (projectId == null) localStorage.removeItem(key(userId))
    else localStorage.setItem(key(userId), String(projectId))
    memory.delete(userId)
  } catch {
    memory.set(userId, projectId)
  }
  if (projectId != null) prompted = false
  for (const s of subs) s()
}

/** A clock-in was tried without the required project: flag the picker until one is chosen. */
export function promptProject(): void {
  prompted = true
  for (const s of subs) s()
}

export const isProjectPrompted = (): boolean => prompted

/** Marks the wrapper of each clock project picker: "hero" (dashboard) or "topbar". */
export const PICKER_ATTR = "data-clock-project"

/** The clock project picker in view, the dashboard's first; null when none is shown (phones, narrow bars). */
export function visibleProjectPicker(): HTMLElement | null {
  for (const place of ["hero", "topbar"]) {
    const el = document.querySelector<HTMLElement>(`[${PICKER_ATTR}=${place}] [role=combobox]`)
    if (el && el.getClientRects().length > 0) return el
  }
  return null
}

export function useProjectPrompt(): boolean {
  return useSyncExternalStore(subscribe, isProjectPrompted, () => false)
}

function subscribe(cb: () => void) {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function useNextProject(userId: number): [number | null, (projectId: number | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readNextProject(userId),
    () => null,
  )
  return [value, (projectId) => writeNextProject(userId, projectId)]
}
