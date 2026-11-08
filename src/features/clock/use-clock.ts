/**
 * Clock state shared by the top bar, the mobile bar and the dashboard card.
 *
 * - Actions are optimistic once the server takes longer than a moment, so a quick refusal never flickers.
 * - Offline (or a network error): a clock in/out is stored in IndexedDB with its click time and a client id,
 *   shown as pending, and replayed with `syncOfflineFn` when the connection returns. While anything is
 *   pending, later actions queue behind it so their order is kept. Scheduling a clock-out ("clock out later")
 *   and cancelling it need the server and are refused offline.
 * - A rejected action (not a network problem) rolls back and shows the reason.
 * - A clock-in books on the project chosen for the next clock-in (next-project.ts); `switch` changes the
 *   project while working. With projects required, a clock-in without one is refused before anything else.
 */
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { clockActionFn, fetchClock, syncOfflineFn } from "@/features/time/api"
import { errorCode, errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import type { I18n } from "@/lib/i18n-core"
import { useBootstrap, useMe } from "@/lib/session"
import type { ClockAction, ClockStateName, OfflineClockAction } from "@/server/services/clock"
import { fmtClockTime, wallClock } from "../time/lib"
import { promptProject, readNextProject, visibleProjectPicker, writeNextProject } from "./next-project"
import { enqueue, isNetworkError, onQueueChange, type QueuedAction, queued, remove } from "./offline-queue"

export type LiveClock = Awaited<ReturnType<typeof fetchClock>> & { receivedAt: number }

export const liveClockQuery = () =>
  queryOptions({
    queryKey: ["clock", "live"],
    queryFn: async (): Promise<LiveClock> => ({ ...(await fetchClock()), receivedAt: Date.now() }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })

const SCHEDULE_AHEAD_MS = 2 * 60_000
const OPTIMISTIC_DELAY_MS = 300

/** A clock-out with a time this far ahead is scheduled ("clock out later") instead of closing the entry. */
export const schedulesLater = (at: string | null | undefined, now: number): boolean =>
  at != null && Date.parse(at) > now + SCHEDULE_AHEAD_MS

/** The primary action for a state: clock in or clock out. */
export function primaryAction(state: ClockStateName): ClockAction {
  return state === "working" ? "stop" : "start"
}

type Person = { timezone: string; timeFormat: string }

/** A scheduled clock-out as "17:30" in the person's zone and clock format. */
export function scheduledTimeText(at: string, me: Person): string {
  return fmtClockTime(wallClock(at, me.timezone).time, me.timeFormat === "12h")
}

/** `now` 0 (SSR, hydration) means "as received": the figures the server rendered. */
const atTime = (c: LiveClock, now: number) => (now > 0 ? now : c.receivedAt)

/** Server time estimate: the server clock at `receivedAt` plus elapsed local time. */
const serverNow = (c: LiveClock, now: number) => Date.parse(c.serverTime) + (atTime(c, now) - c.receivedAt)

/** Minutes worked today, ticking while working (no further than a scheduled clock-out). */
export function liveWorkedMin(c: LiveClock, now: number): number {
  if (c.state !== "working") return c.todayWorkedMin
  let elapsed = Math.max(0, atTime(c, now) - c.receivedAt)
  if (c.scheduledEnd) elapsed = Math.min(elapsed, Math.max(0, Date.parse(c.scheduledEnd) - Date.parse(c.serverTime)))
  return c.todayWorkedMin + elapsed / 60000
}

/** Seconds since the current state started (0 when idle). */
export function liveSinceSec(c: LiveClock, now: number): number {
  return c.since ? Math.max(0, (serverNow(c, now) - Date.parse(c.since)) / 1000) : 0
}

/** Clock state after the queued actions, applied on top of the last server state. */
function withPending(c: LiveClock, pending: QueuedAction[]): LiveClock {
  if (!pending.length) return c
  let out = c
  for (const p of pending) out = advance(out, p.action, p.at, Date.parse(p.at))
  return out
}

/** The optimistic state after `action` at `at` (ISO), as of `now`. */
export function advance(c: LiveClock, action: ClockAction, at: string, now: number): LiveClock {
  if (action === "unschedule") return { ...c, scheduledEnd: null }
  if (action === "switch" && c.state === "working") return { ...c, since: at, entry: null }
  if (action === "stop" && c.state === "working" && schedulesLater(at, now)) return { ...c, scheduledEnd: at }
  const state: ClockStateName = action === "stop" ? "idle" : "working"
  const t = Math.min(now, c.receivedAt + 24 * 3600_000)
  return {
    ...c,
    state,
    since: state === "idle" ? null : at,
    scheduledEnd: null,
    entry: null,
    todayWorkedMin: liveWorkedMin(c, t),
    serverTime: new Date(serverNow(c, t)).toISOString(),
    receivedAt: t,
  }
}

/**
 * Clock-in refusals by the legal minimums carry the time from which clocking in is allowed; they are worded
 * with that time in the person's clock format. Null for every other error.
 */
export function clockErrorText(err: unknown, i18n: Pick<I18n, "t" | "intl">, me: Person): string | null {
  const code = errorCode(err)
  const f = errorFields(err)
  if ((code !== "break_required" && code !== "rest_required") || typeof f?.earliest !== "string") return null
  const time = scheduledTimeText(f.earliest, me)
  const num = new Intl.NumberFormat(i18n.intl)
  if (code === "rest_required") {
    return i18n.t("errors.rest_required", { hours: num.format((Number(f.requiredMin) || 660) / 60), time })
  }
  const required = Number(f.required) || 0
  const hours = required >= 60 ? 9 : required >= 30 ? 7 : 5.5
  return i18n.t("errors.break_required", { required: num.format(required), hours: num.format(hours), time })
}

// ------------------------------------------------------------------ pending queue (shared)

let pendingSnapshot: QueuedAction[] = []
let pendingUser = 0
const pendingSubs = new Set<() => void>()
async function refreshPending() {
  pendingSnapshot = pendingUser ? await queued(pendingUser) : []
  for (const s of pendingSubs) s()
}
function subscribePending(cb: () => void) {
  pendingSubs.add(cb)
  const off = onQueueChange(() => void refreshPending())
  return () => {
    pendingSubs.delete(cb)
    off()
  }
}
const EMPTY: QueuedAction[] = []

function usePending(userId: number): QueuedAction[] {
  useEffect(() => {
    if (pendingUser !== userId) {
      pendingUser = userId
      void refreshPending()
    }
  }, [userId])
  return useSyncExternalStore(
    subscribePending,
    () => (pendingUser === userId ? pendingSnapshot : EMPTY),
    () => EMPTY,
  )
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb)
      window.addEventListener("offline", cb)
      return () => {
        window.removeEventListener("online", cb)
        window.removeEventListener("offline", cb)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}

let busy = false
let syncing: Promise<void> | null = null

interface ClockDeps {
  userId: number
  me: Person
  qc: QueryClient
  i18n: I18n
  projectRequired: boolean
  /** Opens the dashboard, the page with the clock's project picker. */
  toDashboard: () => void
}

function refreshTimeData(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["time"] })
  void qc.invalidateQueries({ queryKey: ["account"] })
  void qc.invalidateQueries({ queryKey: ["compliance"] })
}

function setServer(qc: QueryClient, state: Awaited<ReturnType<typeof fetchClock>>) {
  qc.setQueryData<LiveClock>(liveClockQuery().queryKey, { ...state, receivedAt: Date.now() })
}

async function replayQueue({ userId, qc, i18n: { t, tError } }: ClockDeps) {
  try {
    const items = await queued(userId)
    if (!items.length || !navigator.onLine) return
    const res = await syncOfflineFn({
      data: { actions: items.map(({ id, action, at, projectId }) => ({ id, action, at, projectId })) },
    })
    await remove(res.results.map((r) => r.id))
    setServer(qc, res.clock)
    const rejected = res.results.filter((r) => r.status === "rejected").length
    if (rejected) toast.warning(t("clock.rejected", { count: rejected }))
    else toast.success(t("clock.synced"))
    refreshTimeData(qc)
  } catch (err) {
    if (!isNetworkError(err)) toast.error(tError(err))
  }
}

/** Replay queued actions; safe to call any time (one run at a time). */
function sync(deps: ClockDeps): Promise<void> {
  syncing ??= replayQueue(deps).finally(() => {
    syncing = null
  })
  return syncing
}

export interface ActOptions {
  at?: string
  custom?: boolean
  /** switch: the new project; start: defaults to the project chosen for the next clock-in */
  projectId?: number | null
}

async function runAction(deps: ClockDeps, action: ClockAction, opts: ActOptions, setActing: (acting: boolean) => void) {
  const { userId, qc, me, i18n } = deps
  const { t, tError } = i18n
  const current = qc.getQueryData<LiveClock>(liveClockQuery().queryKey)
  if (busy || !current) return
  const nextProject = readNextProject(userId)
  if (action === "start" && deps.projectRequired && nextProject == null) {
    promptProject()
    // the picker is focused where it is shown; phones and narrow windows choose on the dashboard
    const choose = { label: t("time.choose_project"), onClick: deps.toDashboard }
    toast.error(t("time.project_required"), visibleProjectPicker() ? undefined : { action: choose })
    return
  }
  busy = true
  setActing(true)
  const clickAt = opts.at ?? new Date().toISOString()
  const later = schedulesLater(opts.at, Date.now())
  const projectId = action === "switch" ? (opts.projectId ?? null) : action === "start" ? nextProject : undefined
  // only plain clock in/out punches can wait in the offline queue
  const queueable: OfflineClockAction | null = action === "unschedule" || later ? null : action
  // the choice for the next clock-in is used up by it, and by a clock-out, so it never carries over
  const spendChoice = () => {
    if (action === "start" || action === "stop") writeNextProject(userId, null)
  }
  const queue = async () => {
    if (!queueable) {
      toast.error(t("errors.network"))
      return
    }
    await enqueue({ userId, action: queueable, at: clickAt, projectId })
    spendChoice()
    toast.info(t("clock.queued_offline"))
    void sync(deps)
  }
  try {
    if ((await queued(userId)).length || !navigator.onLine) {
      await queue()
      return
    }
    const optimistic = setTimeout(
      () => qc.setQueryData<LiveClock>(liveClockQuery().queryKey, advance(current, action, clickAt, Date.now())),
      OPTIMISTIC_DELAY_MS,
    )
    try {
      const next = await clockActionFn({
        data: { action, at: opts.at ?? null, custom: Boolean(opts.custom), projectId },
      })
      clearTimeout(optimistic)
      setServer(qc, next)
      spendChoice()
      refreshTimeData(qc)
    } catch (err) {
      clearTimeout(optimistic)
      qc.setQueryData(liveClockQuery().queryKey, current)
      if (isNetworkError(err) && queueable) {
        await queue()
      } else {
        toast.error(clockErrorText(err, i18n, me) ?? tError(err))
        void qc.invalidateQueries({ queryKey: liveClockQuery().queryKey })
      }
    }
  } finally {
    busy = false
    setActing(false)
  }
}

export function useClock() {
  const me = useMe()
  const qc = useQueryClient()
  const i18n = useI18n()
  const query = useQuery(liveClockQuery())
  const pending = usePending(me.id)
  const online = useOnline()
  const [acting, setActing] = useState(false)

  const data = query.data ? withPending(query.data, pending) : undefined
  const projectRequired = useBootstrap().company.projectMode === "required"
  const navigate = useNavigate()
  const toDashboard = () => void navigate({ to: "/" })
  const deps: ClockDeps = { userId: me.id, me, qc, i18n, projectRequired, toDashboard }

  // replay on start and whenever the connection comes back
  const replay = useEffectEvent(() => void sync(deps))
  useEffect(() => {
    if (online && pending.length) replay()
  }, [online, pending.length])

  // a scheduled clock-out happens on the server: fetch the new state once its time has come
  const refetch = useEffectEvent(() => void qc.invalidateQueries({ queryKey: liveClockQuery().queryKey }))
  const scheduledEnd = query.data?.scheduledEnd ?? null
  const serverTime = query.data?.serverTime ?? ""
  const receivedAt = query.data?.receivedAt ?? 0
  useEffect(() => {
    const due = scheduledEnd ? receivedAt + (Date.parse(scheduledEnd) - Date.parse(serverTime)) + 1500 : null
    const id = due == null ? null : setTimeout(refetch, Math.max(0, due - Date.now()))
    return () => {
      if (id != null) clearTimeout(id)
    }
  }, [scheduledEnd, serverTime, receivedAt])

  const act = (action: ClockAction, opts: ActOptions = {}) => runAction(deps, action, opts, setActing)

  return { data, pending: pending.length, online, acting, act, isLoading: query.isLoading }
}
