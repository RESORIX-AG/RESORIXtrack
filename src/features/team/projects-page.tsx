/**
 * Projects people book their time on: create and edit (name, code, colour, team or company-wide,
 * active) and the logged hours per project and person for a period.
 */
import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { FolderPlus } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { Page, PageHeader, Section } from "@/components/app/page"
import { ResponsiveDialog } from "@/components/app/responsive-dialog"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { ColorPicker, PRESET_COLORS } from "@/components/ui/color-picker"
import { Field, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { FilterSelect, SheetSubmit } from "@/features/admin/ui"
import { createProjectFn, projectsQuery, updateProjectFn } from "@/features/projects/api"
import { projectHoursQuery } from "@/features/reports/api"
import { RangePicker } from "@/features/reports/controls"
import { ProjectsPreview } from "@/features/reports/previews"
import { todayIn } from "@/features/time/lib"
import { monthRange } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { ProjectView } from "@/server/services/projects"
import { teamScopeQuery } from "./api"

const col = tableHelper<ProjectView>()

export interface ProjectsSearch {
  from?: string
  to?: string
  project?: number
}

export function ProjectsPage({
  search,
  onSearch,
}: {
  search: ProjectsSearch
  onSearch: (s: Partial<ProjectsSearch>) => void
}) {
  const showInactiveId = useId()
  const { t } = useI18n()
  const me = useMe()
  const today = todayIn(me.timezone)
  const { data } = useSuspenseQuery(projectsQuery(true))
  const allowedTeams = data.teamIds == null ? null : new Set(data.teamIds)
  const [showInactive, setShowInactive] = useState(false)
  const [team, setTeam] = useState("")
  const [editing, setEditing] = useState<ProjectView | "new" | null>(null)
  const range = search.from && search.to ? { from: search.from, to: search.to } : monthRange(today.slice(0, 7))
  const hours = useQuery({ ...projectHoursQuery(range), placeholderData: keepPreviousData })
  const { data: scope } = useSuspenseQuery(teamScopeQuery)
  const rows = data.items.filter(
    (p) =>
      (showInactive || p.isActive) && (!team || (team === "company" ? p.teamId == null : String(p.teamId) === team)),
  )
  const teamsInUse = [
    ...new Map(data.items.filter((p) => p.teamId != null).map((p) => [p.teamId, p.teamName ?? ""])).entries(),
  ]

  const columns = [
    col.accessor("name", {
      header: () => t("team.projects.project"),
      meta: { primary: true },
      cell: (c) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <ColorDot color={c.row.original.color} />
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor("code", {
      header: () => t("team.projects.code"),
      meta: { mobileLabel: t("team.projects.code"), className: "font-mono text-xs text-muted-foreground" },
    }),
    col.accessor((p) => p.teamName ?? "", {
      id: "team",
      header: () => t("common.team"),
      meta: { mobileLabel: t("common.team") },
      cell: (c) => c.getValue() || <StatusBadge tone="brand">{t("team.projects.company_wide")}</StatusBadge>,
    }),
    col.accessor("isActive", {
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) =>
        c.getValue() ? (
          <StatusBadge tone="positive" icon="approved">
            {t("common.active")}
          </StatusBadge>
        ) : (
          <StatusBadge>{t("common.inactive")}</StatusBadge>
        ),
    }),
  ]

  return (
    <Page>
      <PageHeader
        title={t("team.projects.title")}
        actions={
          data.canCreate ? (
            <Button onClick={() => setEditing("new")}>
              <FolderPlus data-icon="inline-start" />
              {t("team.projects.new")}
            </Button>
          ) : null
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(p) => String(p.id)}
        search
        searchPlaceholder={t("team.projects.search")}
        onRowClick={(p) => (p.canManage ? setEditing(p) : onSearch({ project: p.id }))}
        rowClassName={(p) => (p.isActive ? undefined : "opacity-60")}
        empty={t("team.projects.empty")}
        toolbar={
          <>
            {teamsInUse.length ? (
              <FilterSelect
                searchable
                label={t("common.team")}
                value={team}
                onChange={setTeam}
                options={[
                  { value: "", label: t("reports.all_teams") },
                  { value: "company", label: t("team.projects.company_wide") },
                  ...teamsInUse.map(([id, name]) => ({ value: String(id), label: name })),
                ]}
              />
            ) : null}
            <div className="flex items-center gap-2">
              <Switch id={showInactiveId} checked={showInactive} onCheckedChange={setShowInactive} />
              <Label htmlFor={showInactiveId} className="text-sm font-normal">
                {t("team.projects.show_inactive")}
              </Label>
            </div>
          </>
        }
      />
      <Section
        title={t("team.projects.hours")}
        actions={<RangePicker from={range.from} to={range.to} today={today} onChange={(r) => onSearch(r)} />}
      >
        {hours.data ? (
          <ProjectsPreview
            d={hours.data}
            projectId={search.project}
            onProject={(project) => onSearch({ project })}
            link={me.isManager}
          />
        ) : (
          <Skeleton className="h-64 rounded-xl" />
        )}
      </Section>
      {editing ? (
        <ProjectSheet
          project={editing === "new" ? null : editing}
          teams={scope.teams.filter((tm) => allowedTeams?.has(tm.id) ?? true)}
          companyWide={data.canCreateCompanyWide}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Page>
  )
}

const schema = z.object({
  name: z.string().trim().min(1, "errors.fields.required").max(120, "errors.fields.too_long"),
  code: z.string().max(30, "errors.fields.too_long"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "errors.fields.invalid"),
  teamId: z.string(),
  description: z.string().max(500, "errors.fields.too_long"),
  isActive: z.boolean(),
})
type Values = z.infer<typeof schema>

function ProjectSheet({
  project,
  teams,
  companyWide,
  onClose,
}: {
  project: ProjectView | null
  teams: { id: number; name: string }[]
  companyWide: boolean
  onClose: () => void
}) {
  const projectColorId = useId()
  const { t, tError } = useI18n()
  const qc = useQueryClient()
  const defaults: Values = {
    name: project?.name ?? "",
    code: project?.code ?? "",
    color: project?.color ?? PRESET_COLORS[0].value,
    teamId: project ? String(project.teamId ?? 0) : companyWide ? "0" : String(teams[0]?.id ?? 0),
    description: project?.description ?? "",
    isActive: project?.isActive ?? true,
  }
  const form = useAppForm({
    defaultValues: defaults,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const input = { ...value, teamId: Number(value.teamId) || null }
      try {
        if (project) await updateProjectFn({ data: { id: project.id, ...input } })
        else await createProjectFn({ data: input })
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["projects"] }),
          qc.invalidateQueries({ queryKey: ["reports"] }),
        ])
        toast.success(t("common.saved"))
        onClose()
      } catch (err) {
        if (!applyServerErrors(form, err)) toast.error(tError(err))
      }
    },
  })
  const teamOptions = [
    ...(companyWide || project?.teamId == null ? [{ value: "0", label: t("team.projects.company_wide") }] : []),
    ...teams.map((tm) => ({ value: String(tm.id), label: tm.name })),
  ]
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={project ? project.name : t("team.projects.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{t("common.save")}</SheetSubmit>
        </>
      }
    >
      <form.AppForm>
        <FormRoot form={form}>
          <div className="grid grid-cols-[1fr_8rem] gap-4">
            <form.AppField name="name">
              {(f) => <f.TextField label={t("common.name")} autoComplete="off" />}
            </form.AppField>
            <form.AppField name="code">
              {(f) => <f.TextField label={t("team.projects.code")} autoComplete="off" className="font-mono" />}
            </form.AppField>
          </div>
          <form.Field name="color">
            {(f) => (
              <Field>
                <FieldLabel id={projectColorId}>{t("team.projects.color")}</FieldLabel>
                <ColorPicker value={f.state.value} onChange={f.handleChange} aria-labelledby={projectColorId} />
              </Field>
            )}
          </form.Field>
          {teamOptions.length > 1 ? (
            <form.AppField name="teamId">
              {(f) => <f.ComboboxField label={t("common.team")} options={teamOptions} />}
            </form.AppField>
          ) : null}
          <form.AppField name="description">
            {(f) => <f.TextareaField label={t("team.projects.description")} maxLength={500} />}
          </form.AppField>
          {project ? (
            <form.AppField name="isActive">
              {(f) => <f.SwitchField label={t("common.active")} description={t("team.projects.active_help")} />}
            </form.AppField>
          ) : null}
        </FormRoot>
      </form.AppForm>
    </ResponsiveDialog>
  )
}
