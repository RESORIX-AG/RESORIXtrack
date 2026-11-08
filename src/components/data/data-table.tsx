/**
 * DataTable – the one table component of the app (TanStack Table v9).
 *
 *   const columns = tableHelper<Row>().columns([
 *     tableHelper<Row>().accessor("name", { header: () => t("common.name"), meta: { primary: true } }),
 *     tableHelper<Row>().accessor("minutes", { header: "…", cell: (c) => fmtMinutes(c.getValue()), meta: { numeric: true } }),
 *   ])
 *   <DataTable data={rows} columns={columns} getRowId={(r) => String(r.id)} search searchPlaceholder={…} />
 *
 * Behaviour:
 * - sorting by clicking headers (aria-sort), global search (deferred filtering), pagination when > pageSize
 *   (`pageSize={false}` shows every row)
 * - long lists are virtualised: `virtual`, or automatically above VIRTUAL_FROM rows when pagination is off.
 *   Rows render inside a scroll container with a sticky header; only the rows in view are in the DOM, `aria-rowcount`/`aria-rowindex` tell screen readers the full size.
 * - fixed column widths (meta.width) lay the table out by its columns, not its content, so columns never jump
 *   while scrolling or when the data changes (another month, another filter). Virtual tables always do.
 * - `infinite` loads the next server page when the end comes into view (cursor-paginated lists)
 * - optional row selection (checkbox column) with `onSelectionChange`
 * - numeric columns right-aligned with tabular numerals (meta.numeric)
 * - below `md` the table turns into stacked rows: the `primary` column is the row title, the others
 *   become label/value pairs (meta.hideOnMobile to drop a column there)
 * - `onRowClick` makes rows navigable: Enter/Space opens the focused row, ↑/↓ move between rows
 * - empty and loading states built in (skeleton rows while loading, never a spinner)
 *
 * Columns and data must be stable between renders: module scope, query data, or built in a component (the
 * React Compiler memoizes them).
 */
import {
  type Cell,
  type ColumnDef,
  FlexRender,
  type Header,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useDeferredValue, useEffect, useEffectEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useVirtualRows } from "@/hooks/use-virtual-rows"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { type F, tableFeaturesDefault } from "./table-helper"

/** Without pagination, lists longer than this are virtualised. */
export const VIRTUAL_FROM = 150
/** An infinite list asks for the next page when the last row in view is this close to the end. */
const LOAD_AHEAD = 30

export interface InfiniteRows {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
  /** all rows on the server, when known (announced as the table size) */
  total?: number | null
}

export interface DataTableProps<T extends RowData> {
  data: T[]
  // biome-ignore lint/suspicious/noExplicitAny: column value types vary per column
  columns: ColumnDef<F, T, any>[]
  getRowId: (row: T, index: number) => string
  loading?: boolean
  /** show the search field (global filter over string/number columns) */
  search?: boolean
  searchPlaceholder?: string
  /** toolbar content on the right of the search (filters, primary action) */
  toolbar?: ReactNode
  empty?: ReactNode
  /** rows per page; `false` shows all rows (virtualised when long) */
  pageSize?: number | false
  /** force virtual rows on or off (default: on for long unpaginated lists) */
  virtual?: boolean
  /** server-paginated list that grows while scrolling (implies virtual rows, no pager) */
  infinite?: InfiniteRows
  initialSorting?: SortingState
  selectable?: boolean
  onSelectionChange?: (ids: string[]) => void
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  /** caption for screen readers */
  caption?: string
  className?: string
  /** draw the table inside a card surface (default) or flat */
  variant?: "card" | "flat"
}

const EMPTY: never[] = []

export function DataTable<T extends RowData>(props: DataTableProps<T>) {
  const t = useT()
  const { data, columns, getRowId, loading, selectable, onSelectionChange, onRowClick, infinite } = props
  const paginate = props.pageSize !== false && !infinite
  const [sorting, setSorting] = useState<SortingState>(props.initialSorting ?? [])
  const [query, setQuery] = useState("")
  // the input updates at once; filtering a large table renders in the background and is dropped on the next key
  const globalFilter = useDeferredValue(query)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: props.pageSize || 50 })

  // stable between renders: the React Compiler memoizes it on `selectable`, `columns` and `t`
  const allColumns = selectable
    ? [selectColumn<T>(t("common.select_all"), t("common.select_row")), ...columns]
    : columns

  const table = useTable({
    features: tableFeaturesDefault,
    // react-doctor-disable-next-line react-doctor/tanstack-table-no-unstable-data-or-columns
    columns: allColumns,
    data: data ?? EMPTY,
    getRowId,
    state: { sorting, globalFilter, rowSelection, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: (updater) => setQuery(typeof updater === "function" ? updater(query) : updater),
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater
      setRowSelection(next)
      onSelectionChange?.(Object.keys(next).filter((k) => next[k]))
    },
    onPaginationChange: setPagination,
    manualPagination: !paginate,
    globalFilterFn: "includesString",
    enableRowSelection: Boolean(selectable),
    autoResetPageIndex: true,
  })

  const rows = table.getRowModel().rows
  const filteredCount = table.getFilteredRowModel().rows.length
  const pageCount = paginate ? table.getPageCount() : 1
  const headers = table.getHeaderGroups()
  const headerStateKey = `${Object.values(rowSelection).filter(Boolean).length}|${sorting.map((x) => `${x.id}:${x.desc}`).join(",")}`
  const card = (props.variant ?? "card") === "card"
  const skeleton = Boolean(loading && !data?.length)
  const virtual =
    !skeleton && rows.length > 0 && (props.virtual ?? (infinite != null || (!paginate && rows.length > VIRTUAL_FROM)))
  const phone = useIsMobile()
  const body: BodyProps<T> = { rows, onRowClick, rowClassName: props.rowClassName }

  return (
    <div className={cn("flex flex-col gap-3", props.className)}>
      {props.search || props.toolbar ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {props.search ? (
            <InputGroup className="sm:max-w-xs">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={props.searchPlaceholder ?? t("common.search")}
                aria-label={props.searchPlaceholder ?? t("common.search")}
              />
            </InputGroup>
          ) : (
            <span />
          )}
          {props.toolbar ? <div className="flex flex-wrap items-center gap-2">{props.toolbar}</div> : null}
        </div>
      ) : null}

      {virtual ? (
        phone ? (
          <VirtualList {...body} infinite={infinite} card={card} />
        ) : (
          <VirtualTable
            {...body}
            headers={headers}
            caption={props.caption}
            infinite={infinite}
            card={card}
            stateKey={headerStateKey}
          />
        )
      ) : (
        <PlainTable
          {...body}
          stateKey={headerStateKey}
          headers={headers}
          caption={props.caption}
          card={card}
          skeleton={skeleton}
          empty={
            !loading && filteredCount === 0
              ? globalFilter
                ? t("common.no_matches")
                : (props.empty ?? t("common.empty"))
              : null
          }
        />
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="tabular">
            {t("common.page_of", { page: pagination.pageIndex + 1, pages: pageCount })} ·{" "}
            {t("common.rows_count", { count: filteredCount })}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label={t("common.previous")}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label={t("common.next_period")}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface BodyProps<T extends RowData> {
  rows: Row<F, T>[]
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
}

type HeaderGroups<T extends RowData> = { id: string; headers: Header<F, T>[] }[]

/** Every row in the DOM: a table from `md` up, stacked rows below. */
function PlainTable<T extends RowData>({
  rows,
  onRowClick,
  rowClassName,
  headers,
  caption,
  card,
  skeleton,
  empty,
  stateKey,
}: BodyProps<T> & {
  headers: HeaderGroups<T>
  caption?: string
  card: boolean
  skeleton: boolean
  empty: ReactNode
  stateKey: string
}) {
  const leafHeaders = headers.at(-1)?.headers ?? []
  const fixed = leafHeaders.some((h) => h.column.columnDef.meta?.width)
  return (
    // wide tables scroll inside the card, never the page
    <div className={cn(card && "overflow-x-auto rounded-xl border bg-card")}>
      {/* desktop table */}
      <table className={cn("hidden w-full caption-bottom text-sm md:table", fixed && "table-fixed")}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {fixed ? (
          <colgroup>
            {leafHeaders.map((h) => (
              <col key={h.id} style={{ width: h.column.columnDef.meta?.width }} />
            ))}
          </colgroup>
        ) : null}
        <TableHead headers={headers} stateKey={stateKey} />
        <tbody>
          {skeleton
            ? Array.from({ length: 4 }, (_, i) => (
                <tr key={i} className="border-b last:border-0">
                  {leafHeaders.map((h) => (
                    <td key={h.id} className="px-3 py-3 first:pl-4 last:pr-4">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, i) => (
                <BodyRow
                  key={row.id}
                  rows={rows}
                  row={row}
                  selected={row.getIsSelected()}
                  index={i}
                  cells={row.getVisibleCells()}
                  onRowClick={onRowClick}
                  rowClassName={rowClassName}
                />
              ))}
        </tbody>
      </table>

      {/* mobile: stacked rows */}
      <ul className="divide-y md:hidden">
        {skeleton
          ? Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex flex-col gap-2 p-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </li>
            ))
          : rows.map((row) => (
              <MobileRow
                key={row.id}
                row={row}
                selected={row.getIsSelected()}
                cells={row.getVisibleCells()}
                onRowClick={onRowClick}
                className={rowClassName?.(row.original)}
              />
            ))}
      </ul>

      {empty ? <div className="px-4 py-12 text-center text-sm text-muted-foreground">{empty}</div> : null}
    </div>
  )
}

function TableHead<T extends RowData>({
  headers,
  sticky,
  stateKey,
}: {
  headers: HeaderGroups<T>
  sticky?: boolean
  stateKey: string
}) {
  return (
    <thead className={cn(sticky && "sticky top-0 z-10 bg-card")}>
      {headers.map((hg) => (
        <tr key={hg.id} aria-rowindex={sticky ? 1 : undefined} className={cn(!sticky && "border-b")}>
          {hg.headers.map((h) => (
            <HeaderCell key={h.id} header={h} sticky={sticky} stateKey={stateKey} />
          ))}
        </tr>
      ))}
    </thead>
  )
}

/**
 * Moves focus between rows with ↑/↓ (rows carry `data-index`). A virtual list first scrolls a row that is not
 * rendered yet into view.
 */
function moveRowFocus(e: KeyboardEvent<HTMLElement>, index: number, count: number, scrollTo?: (i: number) => void) {
  const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : null
  if (next == null || next < 0 || next >= count) return
  e.preventDefault()
  const body = e.currentTarget.parentElement
  const find = () => body?.querySelector<HTMLElement>(`:scope > [data-index="${next}"]`)
  const el = find()
  if (el) el.focus()
  else if (scrollTo) {
    scrollTo(next)
    requestAnimationFrame(() => find()?.focus())
  }
}

/**
 * `cells` comes from the parent render: `row` keeps its identity while cell renderers change (e.g. a
 * checkbox bound to outside state), so reading cells from `row` here would show stale content.
 */
function BodyRow<T extends RowData>({
  row,
  selected,
  index,
  cells,
  onRowClick,
  rowClassName,
  rows,
  measure,
  rowIndex,
  scrollTo,
}: BodyProps<T> & {
  row: Row<F, T>
  /** plain value so the memoized row re-renders when only the selection changes */
  selected: boolean
  index: number
  cells: Cell<F, T>[]
  measure?: (el: Element | null) => void
  /** aria-rowindex (virtual tables) */
  rowIndex?: number
  scrollTo?: (index: number) => void
}) {
  return (
    <tr
      ref={measure}
      data-index={index}
      aria-rowindex={rowIndex}
      data-state={selected ? "selected" : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      onClick={
        onRowClick
          ? (e) => {
              // controls inside the row (approve, decline, links) act on their own
              if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return
              onRowClick(row.original)
            }
          : undefined
      }
      onKeyDown={
        onRowClick
          ? (e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onRowClick(row.original)
              } else moveRowFocus(e, index, rows.length, scrollTo)
            }
          : undefined
      }
      className={cn(
        "border-b transition-colors duration-150 last:border-0 data-[state=selected]:bg-brand-soft",
        onRowClick && "cursor-pointer hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none",
        rowClassName?.(row.original),
      )}
    >
      {cells.map((cell) => (
        <BodyCell key={cell.id} cell={cell} selected={selected} />
      ))}
    </tr>
  )
}

/** Loads the next page of an infinite list once the last row in view comes close to its end. */
function useLoadMore(infinite: InfiniteRows | undefined, lastVisible: number, count: number) {
  const loadMore = useEffectEvent(() => infinite?.onLoadMore())
  const due = Boolean(infinite?.hasMore && !infinite.loading && lastVisible >= 0 && lastVisible >= count - LOAD_AHEAD)
  useEffect(() => {
    if (due) loadMore()
  }, [due])
}

function LoadingMore({ infinite }: { infinite?: InfiniteRows }) {
  if (!infinite?.hasMore) return null
  return (
    <div className="flex justify-center py-3 text-muted-foreground" aria-hidden>
      <Spinner />
    </div>
  )
}

/** Desktop: the rows in view only, inside a scroll container with a sticky header. */
function VirtualTable<T extends RowData>({
  rows,
  onRowClick,
  rowClassName,
  headers,
  caption,
  infinite,
  card,
  stateKey,
}: BodyProps<T> & {
  headers: HeaderGroups<T>
  caption?: string
  infinite?: InfiniteRows
  card: boolean
  stateKey: string
}) {
  const {
    rows: items,
    after,
    lastVisible,
    scroller,
    measure,
    scrollToIndex,
  } = useVirtualRows({
    count: rows.length,
    estimateSize: 57,
    getItemKey: (i) => rows[i]?.id ?? i,
  })
  useLoadMore(infinite, lastVisible, rows.length)
  const leafHeaders = headers.at(-1)?.headers ?? []
  const total = infinite ? (infinite.total ?? (infinite.hasMore ? null : rows.length)) : rows.length
  return (
    <div
      ref={scroller}
      className={cn("max-h-[calc(100dvh-17rem)] min-h-60 overflow-auto", card && "rounded-xl border bg-card")}
    >
      <table aria-rowcount={total == null ? -1 : total + 1} className="w-full table-fixed text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <colgroup>
          {leafHeaders.map((h) => (
            <col key={h.id} style={{ width: h.column.columnDef.meta?.width }} />
          ))}
        </colgroup>
        <TableHead headers={headers} sticky stateKey={stateKey} />
        <tbody>
          {items.map(({ item, gap }) => {
            const row = rows[item.index]
            return [
              gap > 0 ? <Spacer key={`gap-${item.key}`} height={gap} span={leafHeaders.length} /> : null,
              <BodyRow
                key={row.id}
                rows={rows}
                row={row}
                selected={row.getIsSelected()}
                index={item.index}
                cells={row.getVisibleCells()}
                onRowClick={onRowClick}
                rowClassName={rowClassName}
                measure={measure}
                rowIndex={item.index + 2}
                scrollTo={scrollToIndex}
              />,
            ]
          })}
          {after > 0 ? <Spacer height={after} span={leafHeaders.length} /> : null}
        </tbody>
      </table>
      <LoadingMore infinite={infinite} />
    </div>
  )
}

function Spacer({ height, span }: { height: number; span: number }) {
  return (
    <tr aria-hidden>
      <td aria-hidden colSpan={span} className="p-0" style={{ height }} />
    </tr>
  )
}

/** Phones: the stacked rows in view only, inside a scroll container. */
function VirtualList<T extends RowData>({
  rows,
  onRowClick,
  rowClassName,
  infinite,
  card,
}: BodyProps<T> & { infinite?: InfiniteRows; card: boolean }) {
  const {
    rows: items,
    after,
    lastVisible,
    scroller,
    measure,
  } = useVirtualRows({
    count: rows.length,
    estimateSize: 112,
    getItemKey: (i) => rows[i]?.id ?? i,
  })
  useLoadMore(infinite, lastVisible, rows.length)
  const total = infinite?.total ?? rows.length
  return (
    <div
      ref={scroller}
      className={cn("max-h-[calc(100dvh-13rem)] min-h-60 overflow-auto", card && "rounded-xl border bg-card")}
    >
      <ul className="divide-y">
        {items.map(({ item, gap }) => {
          const row = rows[item.index]
          return [
            gap > 0 ? <li key={`gap-${item.key}`} aria-hidden style={{ height: gap }} /> : null,
            <MobileRow
              key={row.id}
              row={row}
              selected={row.getIsSelected()}
              cells={row.getVisibleCells()}
              onRowClick={onRowClick}
              className={rowClassName?.(row.original)}
              index={item.index}
              setSize={total}
              measure={measure}
            />,
          ]
        })}
        {after > 0 ? <li aria-hidden style={{ height: after }} /> : null}
      </ul>
      <LoadingMore infinite={infinite} />
    </div>
  )
}

/** `stateKey` (selection count + sorting) forces a re-render of select-all and sort arrows; see BodyCell. */
function HeaderCell<T extends RowData>({
  header,
  sticky,
}: {
  header: Header<F, T>
  sticky?: boolean
  stateKey: string
}) {
  "use no memo" // renders TanStack cells, whose objects are reused across state changes (selection, sorting)
  const meta = header.column.columnDef.meta
  const canSort = header.column.getCanSort()
  const sorted = header.column.getIsSorted()
  const content = header.isPlaceholder ? null : <FlexRender header={header} />
  return (
    <th
      scope="col"
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
      className={cn(
        "h-10 px-3 text-left first:pl-4 last:pr-4 align-middle text-xs font-medium tracking-wide text-muted-foreground uppercase whitespace-nowrap",
        // the hairline under a sticky header has to travel with the cells
        sticky && "shadow-[inset_0_-1px_0_var(--color-border)]",
        meta?.numeric && "text-right",
        meta?.className,
        "font-sans", // a cell style like font-mono never changes the header
      )}
    >
      {canSort ? (
        <button
          type="button"
          onClick={header.column.getToggleSortingHandler()}
          className={cn(
            "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase hover:text-foreground",
            meta?.numeric && "flex-row-reverse",
          )}
        >
          {content}
          {sorted === "asc" ? (
            <ArrowUp className="size-3.5" />
          ) : sorted === "desc" ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5 opacity-40" />
          )}
        </button>
      ) : (
        content
      )}
    </th>
  )
}

/**
 * `selected` is passed as a plain value on purpose: TanStack Table reuses row/cell objects between renders, so the
 * React Compiler would otherwise skip re-rendering checkbox and row state when only the selection changed.
 */
function BodyCell<T extends RowData>({ cell }: { cell: Cell<F, T>; selected: boolean }) {
  "use no memo" // renders TanStack cells, whose objects are reused across state changes (selection, sorting)
  const meta = cell.column.columnDef.meta
  return (
    <td
      className={cn(
        "px-3 py-3 align-middle first:pl-4 last:pr-4",
        meta?.numeric && "text-right tabular",
        meta?.className,
      )}
    >
      <FlexRender cell={cell} />
    </td>
  )
}

/** See BodyRow for why `cells` is passed in. */
function MobileRow<T extends RowData>({
  row,
  selected: _selected,
  cells: allCells,
  onRowClick,
  className,
  index,
  setSize,
  measure,
}: {
  row: Row<F, T>
  /** plain value so the memoized row re-renders when only the selection changes */
  selected: boolean
  cells: Cell<F, T>[]
  onRowClick?: (row: T) => void
  className?: string
  /** virtual lists: position and size for screen readers, and the measuring ref */
  index?: number
  setSize?: number
  measure?: (el: Element | null) => void
}) {
  "use no memo" // renders TanStack cells, whose objects are reused across state changes (selection, sorting)
  const cells = allCells.filter((c) => c.column.id !== "__select" && !c.column.columnDef.meta?.hideOnMobile)
  const primary = cells.find((c) => c.column.columnDef.meta?.primary) ?? cells[0]
  // row actions get their own full-width line at the bottom of the card, never squeezed into a half cell
  const actions = cells.find((c) => c.column.id === "actions" && c !== primary)
  const rest = cells.filter((c) => c !== primary && c !== actions)
  const select = allCells.find((c) => c.column.id === "__select")
  const inner = (
    <>
      <div className="flex items-start gap-3">
        {select ? <FlexRender cell={select} /> : null}
        <div className="min-w-0 flex-1 font-medium">{primary ? <FlexRender cell={primary} /> : null}</div>
      </div>
      {rest.length ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {rest.map((c) => {
            const def = c.column.columnDef
            const label = def.meta?.mobileLabel ?? (typeof def.header === "string" ? def.header : "")
            return (
              // a field without a value (an empty day, no note) is left out instead of showing a bare label
              <div key={c.id} className="min-w-0 has-[>dd:empty]:hidden">
                {label ? <dt className="text-xs text-muted-foreground">{label}</dt> : null}
                <dd className={cn("truncate", def.meta?.numeric && "tabular")}>
                  <FlexRender cell={c} />
                </dd>
              </div>
            )
          })}
        </dl>
      ) : null}
      {actions ? (
        <div className="mt-3 [&>*]:justify-start">
          <FlexRender cell={actions} />
        </div>
      ) : null}
    </>
  )
  return (
    <li
      ref={measure}
      data-index={index}
      aria-setsize={setSize}
      aria-posinset={index == null ? undefined : index + 1}
      className={cn("relative p-4", onRowClick && "transition-colors duration-150 hover:bg-accent/60", className)}
    >
      {onRowClick ? (
        // stretched button behind the content, so controls inside the row stay valid, separately clickable elements
        <button
          type="button"
          className="absolute inset-0 focus-visible:bg-accent/60 focus-visible:outline-none"
          onClick={() => onRowClick(row.original)}
        >
          <span className="sr-only">{primary ? <FlexRender cell={primary} /> : null}</span>
        </button>
      ) : null}
      <div
        className={cn(
          onRowClick &&
            "pointer-events-none relative [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_label]:pointer-events-auto",
        )}
      >
        {inner}
      </div>
    </li>
  )
}

const INTERACTIVE = "a, button, input, label, textarea, [role=checkbox], [role=menuitem]"

function selectColumn<T extends RowData>(allLabel: string, rowLabel: string): ColumnDef<F, T> {
  return {
    id: "__select",
    enableSorting: false,
    meta: { className: "w-10", width: "2.75rem" },
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={!table.getIsAllPageRowsSelected() && table.getIsSomePageRowsSelected()}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(v)}
        aria-label={allLabel}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(v) => row.toggleSelected(v)}
        onClick={(e) => e.stopPropagation()}
        aria-label={rowLabel}
      />
    ),
  }
}
