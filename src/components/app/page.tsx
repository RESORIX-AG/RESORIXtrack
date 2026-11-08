/**
 * Page scaffolding. Every page uses <Page> + <PageHeader> so spacing, title size and the action area
 * are identical everywhere:
 *   - one h1 per page (24px/600), optional one-line description (muted)
 *   - `actions`: at most ONE primary button per view; everything else outline/ghost
 *   - content sections are separated by space (gap-6), not by rules
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** One width for every page; reading text keeps its own measure inside (`max-w-prose` on the text block). */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8", className)}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 tabIndex={-1} data-page-heading className="text-2xl font-semibold tracking-tight text-balance outline-none">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      {children}
    </header>
  )
}

/** A titled region inside a page (flat: grouped by space; wrap in <Card> only when it needs a boundary). */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title || actions ? (
        <div className={cn("flex justify-between gap-3", description ? "items-end" : "items-center")}>
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
