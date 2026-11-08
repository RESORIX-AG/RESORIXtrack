/**
 * Clock in/out punches taken while offline, kept in IndexedDB until they are replayed with `syncOfflineFn`.
 * Each action carries a client id, so a retried upload is applied only once (the server remembers ids).
 * Items belong to one person: on a shared device nobody replays someone else's punches.
 */

import { errorCode } from "@/lib/guards"
import type { OfflineClockAction } from "@/server/services/clock"

export interface QueuedAction {
  id: string
  userId: number
  action: OfflineClockAction
  /** ISO instant of the click on the device */
  at: string
  /** Project of a clock-in or switch */
  projectId?: number | null
}

const DB_NAME = "rt-offline"
const STORE = "clock"

let memory: QueuedAction[] = []
let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  dbPromise ??= new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.addEventListener("upgradeneeded", () => req.result.createObjectStore(STORE, { keyPath: "id" }))
    req.addEventListener("success", () => resolve(req.result))
    req.addEventListener("error", () => resolve(null))
  })
  return dbPromise
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) return resolve(undefined)
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.addEventListener("complete", () => resolve(req?.result))
        tx.addEventListener("error", () => reject(tx.error))
      }),
  )
}

const listeners = new Set<() => void>()
const changed = () => {
  for (const l of listeners) l()
}

export function onQueueChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export async function queued(userId: number): Promise<QueuedAction[]> {
  const all = (await run<QueuedAction[]>("readonly", (s) => s.getAll())) ?? memory
  return all.filter((a) => a.userId === userId).sort((a, b) => a.at.localeCompare(b.at))
}

export async function enqueue(item: Omit<QueuedAction, "id">): Promise<QueuedAction> {
  const full = { ...item, id: crypto.randomUUID() }
  const db = await open()
  if (db) await run("readwrite", (s) => s.put(full))
  else memory = [...memory, full]
  changed()
  return full
}

export async function remove(ids: string[]): Promise<void> {
  if (!ids.length) return
  const db = await open()
  if (db)
    await run("readwrite", (s) => {
      for (const id of ids) s.delete(id)
      return undefined
    })
  else {
    const gone = new Set(ids)
    memory = memory.filter((a) => !gone.has(a.id))
  }
  changed()
}

/** A failed request that never reached the server (offline, DNS, connection reset). */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true
  return err instanceof TypeError || errorCode(err) === "network"
}
