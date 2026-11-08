/**
 * The palette's dialog (cmdk and the search), loaded with the first open. Results appear after 2 characters;
 * the server search is debounced (network), the list renders the latest answer.
 */
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CalendarPlus, Clock, FolderKanban, Plus, UserRound, Users } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { searchFn } from "@/features/search/api"
import { useT } from "@/lib/i18n"
import { useBootstrap, useMe } from "@/lib/session"
import { buildNav } from "./nav"
import { ColorDot } from "./status-badge"

export default function CommandPaletteDialog({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const t = useT()
  const me = useMe()
  const b = useBootstrap()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 150)
    return () => clearTimeout(id)
  }, [query])

  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchFn({ data: { q: debounced } }),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  })

  const go = (to: string, search?: Record<string, string>) => {
    setOpen(false)
    setQuery("")
    void navigate({ to, search })
  }
  const pages = buildNav(me, b).flatMap((g) => g.items)
  const people = results.data?.filter((h) => h.kind === "person") ?? []
  const projectHits = results.data?.filter((h) => h.kind === "project") ?? []
  const teamHits = results.data?.filter((h) => h.kind === "team") ?? []

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("search.title")} description={t("search.description")}>
      <Command>
        <CommandInput value={query} onValueChange={setQuery} placeholder={t("search.input_placeholder")} />
        <CommandList>
          <CommandEmpty>
            {debounced.length >= 2 && results.isFetching ? t("common.loading") : t("search.empty")}
          </CommandEmpty>
          {people.length ? (
            <CommandGroup heading={t("search.people")}>
              {people.map((h) => (
                <CommandItem
                  key={`p${h.id}`}
                  value={`person ${h.title} ${h.subtitle}`}
                  onSelect={() =>
                    me.isHr || me.isLead ? go(`/team/member/${h.id}`) : go("/admin/users", { user: String(h.id) })
                  }
                >
                  <UserRound />
                  <span className="flex-1 truncate">{h.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {projectHits.length ? (
            <CommandGroup heading={t("search.projects")}>
              {projectHits.map((h) => (
                <CommandItem
                  key={`pr${h.id}`}
                  value={`project ${h.title} ${h.subtitle}`}
                  onSelect={() => go("/reports", { tab: "projects", project: String(h.id) })}
                >
                  {h.color ? <ColorDot color={h.color} /> : <FolderKanban />}
                  <span className="flex-1 truncate">{h.title}</span>
                  {h.subtitle ? <span className="text-xs text-muted-foreground">{h.subtitle}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {teamHits.length ? (
            <CommandGroup heading={t("search.teams")}>
              {teamHits.map((h) => (
                <CommandItem
                  key={`t${h.id}`}
                  value={`team ${h.title}`}
                  onSelect={() => go(me.isAdmin ? "/admin/teams" : "/team")}
                >
                  <Users />
                  {h.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading={t("search.actions")}>
            <CommandItem
              value={`action add time entry ${t("search.add_time")}`}
              onSelect={() => go("/time", { add: "1" })}
            >
              <Plus />
              {t("search.add_time")}
            </CommandItem>
            <CommandItem
              value={`action request absence vacation ${t("search.request_absence")} ${t("absence_types.vacation")}`}
              onSelect={() => go("/absences", { request: "1" })}
            >
              <CalendarPlus />
              {t("search.request_absence")}
            </CommandItem>
            <CommandItem value={`action clock ${t("search.clock")}`} onSelect={() => go("/")}>
              <Clock />
              {t("search.clock")}
              <CommandShortcut>S</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t("search.pages")}>
            {pages.map((p) => (
              <CommandItem key={p.to} value={`page ${t(p.labelKey)}`} onSelect={() => go(p.to)}>
                <p.icon />
                {t(p.labelKey)}
              </CommandItem>
            ))}
            <CommandItem value={`page ${t("nav.profile")}`} onSelect={() => go("/profile")}>
              <UserRound />
              {t("nav.profile")}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
