import { ChevronDown } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { FIELD_TRIGGER } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
  hint?: string
  icon?: ReactNode
  badge?: ReactNode
}

/**
 * Searchable single choice for dynamic or long lists (teams, people, projects, calendars, timezones, regions).
 * Short fixed lists (up to 6) use `Select`; 2 to 5 visible options use `Segmented`.
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  invalid,
  className,
  allowClear,
  disabled,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  id?: string
  value: string | null
  onChange: (value: string | null) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  invalid?: boolean
  className?: string
  allowClear?: string
  disabled?: boolean
  "aria-label"?: string
  "aria-describedby"?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const listId = useId()
  const current = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            disabled={disabled}
            className={cn(FIELD_TRIGGER, "h-9 w-full", !current && "text-muted-foreground", className)}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {current?.icon}
          <span className="min-w-0 truncate">{current?.label ?? placeholder ?? t("common.search")}</span>
          {current?.badge}
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? t("common.search")} />
          <CommandList id={listId}>
            <CommandEmpty>{t("common.no_matches")}</CommandEmpty>
            <CommandGroup>
              {allowClear ? (
                <CommandItem
                  value={`__clear ${allowClear}`}
                  data-checked={value == null}
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  <span className="text-muted-foreground">{allowClear}</span>
                </CommandItem>
              ) : null}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ""} ${o.value}`}
                  data-checked={o.value === value}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  {o.icon}
                  <span className="min-w-0 truncate">{o.label}</span>
                  {o.badge}
                  {o.hint ? <CommandHint>{o.hint}</CommandHint> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
