/** Table features and the typed column helper shared by every DataTable (see data-table.tsx). */
import {
  type ColumnDef,
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  type RowData,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table"

export const tableFeaturesDefault = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, datetime: sortFn_datetime, text: sortFn_text },
  filterFns: { includesString: filterFn_includesString },
})
export type F = typeof tableFeaturesDefault

declare module "@tanstack/react-table" {
  interface ColumnMeta<TFeatures, TData, TValue> {
    /** right-aligned, tabular numerals */
    numeric?: boolean
    /** title of the stacked row on mobile */
    primary?: boolean
    hideOnMobile?: boolean
    /** label used in the stacked mobile layout when the header is not a plain string */
    mobileLabel?: string
    className?: string
    /** column width (CSS length); any width lays the table out fixed, columns without one share the rest */
    width?: string
  }
}

/** Typed column helper bound to the app's table features. */
export function tableHelper<T extends RowData>() {
  return createColumnHelper<F, T>()
}
export type AppColumnDef<T extends RowData> = ColumnDef<F, T>
