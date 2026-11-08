import { cn } from "@/lib/utils"
import { CANTON_PATHS, CANTON_VIEWBOX } from "./canton-map-paths"

const CANTONS = Object.entries(CANTON_PATHS)

/**
 * Pick a canton by pointer. A shortcut beside the canton combobox, which stays the accessible control, so the
 * map is hidden from assistive technology and from narrow screens.
 */
export function CantonMap({
  value,
  onSelect,
  labels,
  className,
}: {
  /** preset key, "CH-FR" */
  value: string | null
  onSelect: (key: string) => void
  labels: Record<string, string>
  className?: string
}) {
  return (
    <svg viewBox={CANTON_VIEWBOX} aria-hidden="true" className={cn("hidden h-auto w-full sm:block", className)}>
      {CANTONS.map(([code, d]) => {
        const key = `CH-${code}`
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut; the combobox is the accessible control
          <path
            key={code}
            d={d}
            fillRule="evenodd"
            data-canton={code}
            onClick={() => onSelect(key)}
            className={cn(
              "cursor-pointer stroke-background stroke-[1.5] transition-colors",
              key === value ? "fill-primary" : "fill-muted hover:fill-accent-foreground/25",
            )}
          >
            <title>{labels[key] ?? code}</title>
          </path>
        )
      })}
    </svg>
  )
}
