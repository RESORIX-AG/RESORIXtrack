import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Bell } from "lucide-react"
import { startTransition, useOptimistic, useState } from "react"
import { RelativeTime } from "@/components/app/relative-time"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n"
import { useBootstrap, useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { markNotificationsRead, notificationsQuery } from "./api"
import { notificationHref, notificationText } from "./text"

type NotificationList = { items?: { id: number; read: boolean }[]; unread: number }

function applyRead<T extends NotificationList>(state: T, ids: number[] | null): T {
  const hit = (id: number) => ids === null || ids.includes(id)
  const newlyRead = state.items?.filter((n) => !n.read && hit(n.id)).length ?? 0
  return {
    ...state,
    items: state.items?.map((n) => (hit(n.id) ? { ...n, read: true } : n)),
    unread: ids === null ? 0 : Math.max(0, state.unread - newlyRead),
  }
}

export function NotificationsBell() {
  const i = useI18n()
  const me = useMe()
  // the badge counts from the bootstrap (refreshed with it); the list loads while the popover is open
  const unreadCount = useBootstrap().counts.unread
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const q = useQuery({ ...notificationsQuery, enabled: open })
  // read marks show at once; both are reloaded when the Action settles (a failure falls back to them)
  const [{ items, unread }, markLocally] = useOptimistic(
    { items: q.data?.items, unread: unreadCount },
    (state, ids: number[] | null) => applyRead(state, ids),
  )
  const markRead = (ids: number[] | null) =>
    startTransition(async () => {
      markLocally(ids)
      await markNotificationsRead({ data: { ids } }).catch(() => undefined)
      await Promise.all([
        // fetched even with the popover closed (a disabled query ignores invalidation), so a reopen is current
        qc.prefetchQuery({ ...notificationsQuery, staleTime: 0 }),
        qc.invalidateQueries({ queryKey: ["bootstrap"] }),
      ])
    })
  const label = unread > 0 ? i.t("notifications.title_unread", { count: unread }) : i.t("notifications.title")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={label} />}>
        <Bell />
        {unread > 0 ? (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">{i.t("notifications.title")}</p>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => markRead(null)}>
              {i.t("notifications.mark_all")}
            </Button>
          ) : null}
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {q.isPending ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : items?.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{i.t("notifications.empty")}</p>
          ) : (
            items?.map((n) => {
              const href = notificationHref(n, me.id)
              return (
                <Link
                  key={n.id}
                  to={href.to}
                  search={href.search}
                  onClick={() => {
                    setOpen(false)
                    if (!n.read) markRead([n.id])
                  }}
                  className={cn(
                    "flex gap-3 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    n.read && "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-pretty">{notificationText(n, me.id, me.name, i)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      <RelativeTime at={n.createdAt} />
                    </span>
                  </span>
                </Link>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
