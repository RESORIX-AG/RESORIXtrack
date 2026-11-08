/**
 * Charts, loaded on demand: the chart library is the largest dependency and most pages show no chart, so it
 * is fetched when a chart first renders. The fallback reserves the chart's height (no layout jump).
 * Add new charts to ./charts-impl.tsx (conventions there) and a lazy wrapper here.
 */
import { type ComponentProps, lazy, type ReactNode, Suspense, useSyncExternalStore } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type * as Impl from "./charts-impl"

export type { BalancePoint, DayBar, HBar } from "./charts-impl"

const load = () => import("./charts-impl")
const LazyDayBars = lazy(() => load().then((m) => ({ default: m.DayBarsChart })))
const LazyHBar = lazy(() => load().then((m) => ({ default: m.HBarChart })))
const LazyBalance = lazy(() => load().then((m) => ({ default: m.BalanceChart })))

export interface LegendItem {
  label: string
  /** CSS colour (token), e.g. "var(--positive)" */
  color: string
  /** dashed rule instead of a dot (target lines) */
  dashed?: boolean
}

const noSubscribe = () => () => {}

export function ChartFrame({
  children,
  className,
  srTable,
  legend,
}: {
  children: ReactNode
  className?: string
  srTable?: ReactNode
  legend?: readonly LegendItem[]
}) {
  // the server lays the SVG out for a default width, so until hydration measures the container it would show
  // squeezed and then snap to size: it keeps its space but stays hidden until it has its real width
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
  return (
    <figure className={cn("rt-chart m-0", className)}>
      <div className={hydrated ? undefined : "invisible"}>{children}</div>
      {legend?.length ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              {l.dashed ? (
                <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: l.color }} aria-hidden />
              ) : (
                <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
              )}
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {srTable ? <figcaption className="sr-only">{srTable}</figcaption> : null}
    </figure>
  )
}

function ChartSkeleton({ height }: { height: number }) {
  return <Skeleton className="w-full rounded-lg" style={{ height }} />
}

export function DayBarsChart(props: ComponentProps<typeof Impl.DayBarsChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height ?? 200} />}>
      <LazyDayBars {...props} />
    </Suspense>
  )
}

export function HBarChart(props: ComponentProps<typeof Impl.HBarChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={Math.max(96, props.rows.length * 30 + 40)} />}>
      <LazyHBar {...props} />
    </Suspense>
  )
}

export function BalanceChart(props: ComponentProps<typeof Impl.BalanceChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height ?? 220} />}>
      <LazyBalance {...props} />
    </Suspense>
  )
}
