/**
 * ⌘K / Ctrl+K command palette: jump to any page, run frequent actions, find people, projects and teams.
 * Pages come from the navigation model (so permissions are identical), records from the server
 * (`searchFn`, permission-filtered). The dialog is its own chunk: it loads when the page is idle, on
 * hover/focus of the search button, or with the first open.
 */
import { Search } from "lucide-react"
import { lazy, Suspense, useEffect, useEffectEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useT } from "@/lib/i18n"

const loadDialog = () => import("./command-palette-dialog")
const CommandPaletteDialog = lazy(loadDialog)
const prefetch = () => void loadDialog()

export function CommandPalette() {
  const t = useT()
  const [open, setOpen] = useState(false)
  // mounted from the first open on, so closing animates and the typed query survives a reopen
  const [used, setUsed] = useState(false)
  const show = (next: boolean) => {
    if (next) setUsed(true)
    setOpen(next)
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault()
      show(!open)
    }
  })
  useEffect(() => {
    window.addEventListener("keydown", onKey)
    // loaded once the page is idle, so ⌘K opens at once and no keystroke typed right after it is lost
    const hasIdle = "requestIdleCallback" in window
    const id = hasIdle ? requestIdleCallback(prefetch) : window.setTimeout(prefetch, 2000)
    return () => {
      window.removeEventListener("keydown", onKey)
      if (hasIdle) cancelIdleCallback(id)
      else clearTimeout(id)
    }
  }, [])

  return (
    <>
      <Button
        variant="ghost"
        className="hidden h-9 w-56 justify-start gap-2 rounded-lg border border-border bg-muted/40 pr-1 pl-3 font-normal text-muted-foreground hover:bg-muted lg:inline-flex"
        onClick={() => show(true)}
        onPointerEnter={prefetch}
        onFocus={prefetch}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">{t("search.placeholder")}</span>
        <Kbd className="h-7 rounded-sm bg-background/70 px-2">⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t("search.placeholder")}
        onClick={() => show(true)}
        onPointerEnter={prefetch}
        onFocus={prefetch}
      >
        <Search />
      </Button>
      {used ? (
        <Suspense fallback={null}>
          <CommandPaletteDialog open={open} setOpen={show} />
        </Suspense>
      ) : null}
    </>
  )
}
