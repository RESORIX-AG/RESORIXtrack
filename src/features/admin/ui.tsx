/**
 * Building blocks shared by the administration pages: the responsive editor sheet, filter selects, a server-side pager and the mutation helper.
 */
import { type AnyFormApi, useStore } from "@tanstack/react-form"
import { type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SHORT_LIST } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  type SheetSize,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useI18n, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const ALL = "__all"

/** Side sheet on desktop, bottom sheet on phones. Forms inside scroll; the footer stays put. */
export function EditorSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: SheetSize
}) {
  const mobile = useIsMobile()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        size={size}
        className={cn("gap-0 p-0 shadow-overlay", mobile && "max-h-[92dvh] rounded-t-xl")}
      >
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

type SubmittableForm = Pick<AnyFormApi, "handleSubmit" | "store">

/** Submit button for a form whose button sits outside the <form> (sheet footer). Focuses the first invalid field. */
export function SheetSubmit({
  form,
  children,
  variant,
}: {
  form: SubmittableForm
  children: ReactNode
  variant?: "default" | "destructive"
}) {
  const submitting = useStore(form.store, (s) => s.isSubmitting)
  return (
    <Button
      type="button"
      variant={variant}
      disabled={submitting}
      onClick={async (e) => {
        const root = e.currentTarget.closest("[data-slot=sheet-content]")
        await form.handleSubmit()
        root?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()
      }}
    >
      {submitting ? <Spinner data-icon="inline-start" /> : null}
      {children}
    </Button>
  )
}

/** Run a server call with a success toast and invalidation; errors are toasted (translated by code). */
export function useAction<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult) => string)
    invalidate?: QueryKey[]
    onSuccess?: (r: TResult, vars: TVars) => void
    silentError?: boolean
  } = {},
) {
  const qc = useQueryClient()
  const { tError } = useI18n()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, vars) => {
      await Promise.all((opts.invalidate ?? [["admin"]]).map((queryKey) => qc.invalidateQueries({ queryKey })))
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success
      if (msg) toast.success(msg)
      opts.onSuccess?.(r, vars)
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(tError(err))
    },
  })
}

/** Compact select for table toolbars. `""` means "all". `searchable` for dynamic lists (teams, people). */
export function FilterSelect({
  value,
  onChange,
  options,
  label,
  className,
  searchable = options.length > SHORT_LIST,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
  className?: string
  searchable?: boolean
}) {
  if (searchable) {
    return (
      <Combobox
        aria-label={label}
        className={cn("w-auto min-w-36", className)}
        value={value || ALL}
        onChange={(v) => onChange(v === ALL || v == null ? "" : v)}
        options={options.map((o) => ({ value: o.value || ALL, label: o.label }))}
      />
    )
  }
  return (
    <Select
      items={options.map((o) => ({ value: o.value || ALL, label: o.label }))}
      value={value || ALL}
      onValueChange={(v) => onChange(v === ALL || v == null ? "" : v)}
    >
      <SelectTrigger aria-label={label} className={cn("min-w-36", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || ALL} value={o.value || ALL}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Pager for tables paginated on the server. */
export function ServerPager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const t = useT()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span className="tabular">
        {t("admin.common.range", { from: (page - 1) * pageSize + 1, to: Math.min(total, page * pageSize), total })}
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label={t("common.previous")}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          aria-label={t("common.next_period")}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
