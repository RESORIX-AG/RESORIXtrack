/**
 * Project choice for time entries and the clock: the person's active projects, plus "No project" unless the
 * company requires one.
 */
import { useQuery } from "@tanstack/react-query"
import { ColorDot } from "@/components/app/status-badge"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { useT } from "@/lib/i18n"
import { useBootstrap } from "@/lib/session"
import type { EntryProject } from "@/server/services/project-time"
import type { Settings } from "@/server/services/settings.schemas"
import { projectsQuery } from "./api"

export const NO_PROJECT = "none"

export type ProjectMode = Settings["project_mode"]

export function useProjectMode(): ProjectMode {
  return useBootstrap().company.projectMode
}

/** Shown on an entry: the project (also an inactive one) or nothing. */
export type ShownProject = EntryProject

/** Options for the picker; `current` stays selectable even when it is inactive or not in the list. */
export function useProjectOptions(current?: ShownProject | null): ComboboxOption[] {
  const t = useT()
  const required = useProjectMode() === "required"
  const items = useQuery(projectsQuery()).data?.items ?? []
  const list: ShownProject[] = current && !items.some((p) => p.id === current.id) ? [current, ...items] : items
  return [
    ...(required ? [] : [{ value: NO_PROJECT, label: t("time.no_project") }]),
    ...list.map((p) => ({
      value: String(p.id),
      label: p.name,
      icon: <ColorDot color={p.color} />,
      hint: [p.code, !p.isActive && t("time.inactive")].filter(Boolean).join(" · ") || undefined,
    })),
  ]
}

export function ProjectPicker({
  value,
  onChange,
  current,
  id,
  invalid,
  className,
  "aria-label": ariaLabel,
}: {
  /** Project id, or null for none. */
  value: number | null
  onChange: (projectId: number | null) => void
  current?: ShownProject | null
  id?: string
  invalid?: boolean
  className?: string
  "aria-label"?: string
}) {
  const t = useT()
  const options = useProjectOptions(current)
  return (
    <Combobox
      id={id}
      invalid={invalid}
      className={className}
      aria-label={ariaLabel}
      options={options}
      placeholder={t("time.choose_project")}
      value={value == null ? NO_PROJECT : String(value)}
      onChange={(v) => onChange(v == null || v === NO_PROJECT ? null : Number(v))}
    />
  )
}

/** "INT" or "Internal": the short label of a project on narrow places. */
export const projectShort = (p: Pick<ShownProject, "code" | "name">): string => p.code || p.name
