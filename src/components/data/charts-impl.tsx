/**
 * Chart implementations (TanStack Charts), loaded on demand through ./charts.tsx. Import from there.
 *
 * Charts (TanStack Charts). Read node_modules/@tanstack/charts/llms.txt and docs/ for the grammar.
 * Conventions:
 * - wrap every chart in <ChartFrame> (palette tokens, accessible name, exact-value alternative)
 * - durations are minutes in data; format ticks/tooltips with fmtMinutes
 * - colour comes from tokens (var(--work), var(--positive) …); never hard-code hex
 * - memoize definitions (React Compiler does this for values derived in render)
 * - give every chart an `ariaLabel` and, where values matter, a visually hidden table (srTable)
 */
import { barX, barY, defineChart, ruleX, ruleY } from "@tanstack/charts"
import { Chart } from "@tanstack/charts/react"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { portal } from "@tanstack/charts/tooltip/portal"
import { fmtMinutes } from "@/lib/format"
import { ChartFrame } from "./charts"
import { hourAxis, hourTicks } from "./hour-axis"

/**
 * One tooltip for every chart: anchored above the focused bar (never on top of it), formatted values only
 * (label + duration), styled like our popovers through the --ts-chart-tooltip-* variables in styles.css.
 */
const TOOLTIP = {
  use: tooltip,
  portal,
  className: "rt-chart-tooltip",
  anchor: "point",
  placement: ["top", "bottom"],
  offset: 10,
} as const

/**
 * Chart style = app style: token colours, no axis lines or tick stubs, hairline grid in the border colour,
 * small muted tabular labels, bars rounded only at their free end, a quiet baseline at zero.
 */
const THEME = {
  foreground: "var(--muted-foreground)",
  muted: "var(--muted-foreground)",
  grid: "var(--border)",
  background: "transparent",
} as const
const GRID = { stroke: "var(--border)", strokeWidth: 1 } as const
const LABELS = { fontSize: 11 } as const
const BAR_END = { end: 4 } as const
const BASELINE = { stroke: "var(--border)", strokeWidth: 1 } as const

/** Value axis: grid + labels only. */
function valueAxis<T extends number>(values: readonly T[], format: (v: T) => string) {
  return { line: false, ticks: { values, size: 0, padding: 8, format }, tickLabels: LABELS } as const
}
/** Category axis: labels only. */
const CATEGORY_AXIS = { line: false, ticks: { size: 0, padding: 8 }, tickLabels: LABELS } as const

export interface DayBar {
  /** short label (Mon, Tue …) */
  label: string
  minutes: number
  targetMinutes: number
  isToday?: boolean
}

/** Worked minutes per day against the daily target (dashboard week, time views). */
export function DayBarsChart({
  days,
  ariaLabel,
  height = 200,
  legend,
}: {
  days: readonly DayBar[]
  ariaLabel: string
  height?: number
  /** labels for "target reached" / "worked" / "target" (colour never carries meaning alone) */
  legend?: { reached: string; worked: string; target: string }
}) {
  const axis = hourAxis(Math.max(0, ...days.map((d) => Math.max(d.minutes, d.targetMinutes))))
  const definition = defineChart({
    marks: [
      barY(days, {
        x: "label",
        y: "minutes",
        fill: (d: DayBar) => (d.targetMinutes > 0 && d.minutes >= d.targetMinutes ? "var(--positive)" : "var(--work)"),
        radius: BAR_END,
        maxThickness: 56,
      }),
      ruleY([0], { y: (v: number) => v, ...BASELINE }),
      ruleY(
        days.filter((d) => d.targetMinutes > 0),
        { y: "targetMinutes", stroke: "var(--muted-foreground)", strokeOpacity: 0.5, strokeDasharray: "4 4" },
      ),
    ],
    scales: {
      x: { scale: () => scaleBand().padding(0.36), axis: CATEGORY_AXIS },
      y: {
        scale: scaleLinear().domain(axis.domain),
        grid: GRID,
        axis: valueAxis(axis.ticks, (v: number) => fmtMinutes(v)),
      },
    },
    theme: THEME,
    tooltip: {
      ...TOOLTIP,
      format: (p: { datum: DayBar }) =>
        `${p.datum.label}  ${fmtMinutes(p.datum.minutes)}${p.datum.targetMinutes > 0 ? ` / ${fmtMinutes(p.datum.targetMinutes)}` : ""}`,
    },
  })
  return (
    <ChartFrame
      legend={
        legend && [
          { label: legend.reached, color: "var(--positive)" },
          { label: legend.worked, color: "var(--work)" },
          { label: legend.target, color: "var(--muted-foreground)", dashed: true },
        ]
      }
      srTable={
        <table>
          <tbody>
            {days.map((d) => (
              <tr key={d.label}>
                <th>{d.label}</th>
                <td>{fmtMinutes(d.minutes)}</td>
                <td>{fmtMinutes(d.targetMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Chart definition={definition} height={height} ariaLabel={ariaLabel} />
    </ChartFrame>
  )
}

export interface HBar {
  /** unique row label (person, project) */
  label: string
  minutes: number
  /** category colour (project, team); defaults to the work token, or positive/negative when `signed` */
  color?: string
}

/** Horizontal bars of durations, e.g. hours per project or balance per person (`signed`: +/− colours, zero rule). */
export function HBarChart({ rows, ariaLabel, signed }: { rows: readonly HBar[]; ariaLabel: string; signed?: boolean }) {
  const fill = (d: HBar) =>
    d.color || (signed ? (d.minutes < 0 ? "var(--negative)" : "var(--positive)") : "var(--work)")
  const lo = Math.min(0, ...rows.map((r) => r.minutes))
  const hi = Math.max(0, ...rows.map((r) => r.minutes))
  const ticks = hourTicks(lo, hi)
  const definition = defineChart({
    marks: [barX(rows, { x: "minutes", y: "label", fill, radius: BAR_END, maxThickness: 18 }), ruleX([0], BASELINE)],
    scales: {
      y: {
        scale: () =>
          scaleBand()
            .domain(rows.map((r) => r.label))
            .padding(0.3),
        axis: CATEGORY_AXIS,
      },
      x: {
        scale: () => scaleLinear().domain([ticks[0], ticks[ticks.length - 1]]),
        grid: GRID,
        axis: valueAxis(ticks, (v: number) => `${fmtMinutes(v, { sign: signed }).replace(/:00$/, "")} h`),
      },
    },
    theme: THEME,
    tooltip: {
      ...TOOLTIP,
      placement: ["right", "left", "top"],
      format: (p: { datum: HBar }) => `${p.datum.label}  ${fmtMinutes(p.datum.minutes, { sign: signed })}`,
    },
  })
  return (
    <ChartFrame
      srTable={
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th>{r.label}</th>
                <td>{fmtMinutes(r.minutes, { sign: signed })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Chart definition={definition} height={Math.max(96, rows.length * 30 + 40)} ariaLabel={ariaLabel} />
    </ChartFrame>
  )
}

export interface BalancePoint {
  /** short label (Jan, Feb …) */
  label: string
  /** running balance at the end of the period, minutes (signed) */
  minutes: number
}

/** Running time balance per month: bars above (overtime) or below (deficit) the zero line. */
export function BalanceChart({
  points,
  ariaLabel,
  height = 220,
}: {
  points: readonly BalancePoint[]
  ariaLabel: string
  height?: number
}) {
  const lo = Math.min(0, ...points.map((p) => p.minutes))
  const hi = Math.max(0, ...points.map((p) => p.minutes))
  const span = hourAxis(Math.max(hi - lo, 60), 60)
  const step = span.ticks[1] ?? 60
  const domain: [number, number] = [Math.floor(lo / step) * step, Math.max(step, Math.ceil(hi / step) * step)]
  const ticks: number[] = []
  for (let v = domain[0]; v <= domain[1]; v += step) ticks.push(v)
  const definition = defineChart({
    marks: [
      barY(points, {
        x: "label",
        y: "minutes",
        fill: (p: BalancePoint) => (p.minutes < 0 ? "var(--negative)" : "var(--positive)"),
        radius: BAR_END,
        maxThickness: 56,
      }),
      ruleY([0], { y: (v: number) => v, ...BASELINE }),
    ],
    scales: {
      x: { scale: () => scaleBand().padding(0.5), axis: CATEGORY_AXIS },
      y: {
        scale: scaleLinear().domain(domain),
        grid: GRID,
        axis: valueAxis(ticks, (v: number) => fmtMinutes(v, { sign: true })),
      },
    },
    theme: THEME,
    tooltip: {
      ...TOOLTIP,
      format: (p: { datum: BalancePoint }) => `${p.datum.label}  ${fmtMinutes(p.datum.minutes, { sign: true })}`,
    },
  })
  return (
    <ChartFrame
      srTable={
        <table>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <th>{p.label}</th>
                <td>{fmtMinutes(p.minutes, { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Chart definition={definition} height={height} ariaLabel={ariaLabel} />
    </ChartFrame>
  )
}
