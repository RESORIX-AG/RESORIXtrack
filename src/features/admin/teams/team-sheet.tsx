import { useSuspenseQuery } from "@tanstack/react-query"
import { Check, X } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConfirmDialog } from "@/components/app/confirm"
import { Segmented } from "@/components/app/segmented"
import { StatusBadge } from "@/components/app/status-badge"
import { undoToast } from "@/components/app/undo-toast"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { ColorPicker } from "@/components/ui/color-picker"
import { Combobox } from "@/components/ui/combobox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldLabel } from "@/components/ui/field"

import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { TeamRow } from "@/server/services/teams"
import { addLeadFn, deleteTeamFn, removeLeadFn, saveTeamFn, teamsQuery } from "../api/teams"
import { userRefsQuery } from "../api/users"
import { EditorSheet, SheetSubmit, useAction } from "../ui"
import { FormGroup } from "../users/user-fields"
import { fmtPeriod } from "./periods"

const BRAND_DEFAULT = "#35a1cc"
const LEAD_ROLES = ["lead", "deputy"] as const

export function TeamSheet({
  teamId,
  onClose,
  onCreated,
}: {
  teamId: number | null
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const teamColorId = useId()
  const { t, tError } = useI18n()
  const { data: teams } = useSuspenseQuery(teamsQuery)
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  const team = teamId != null ? teams.find((x) => x.id === teamId) : undefined
  const companyCalendar = refs.calendars.find((c) => c.isDefault)
  // the company calendar is stored as null so the team follows a later change of the default
  const teamCalendarId = (value: string) => {
    const id = Number(value) || null
    return id === companyCalendar?.id ? null : id
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = useAction(
    (v: { name: string; color: string; holidayCalendarId: string; memberIds: number[] }) =>
      saveTeamFn({
        data: {
          id: teamId,
          input: { name: v.name.trim(), color: v.color, holidayCalendarId: teamCalendarId(v.holidayCalendarId) },
          memberIds: v.memberIds,
        },
      }),
    {
      success: t("common.saved"),
      silentError: true,
      onSuccess: (r) => (teamId == null ? onCreated(r.id) : onClose()),
    },
  )
  const remove = useAction((id: number) => deleteTeamFn({ data: { id } }), {
    success: t("admin.teams.deleted"),
    onSuccess: onClose,
  })
  const form = useAppForm({
    defaultValues: {
      name: team?.name ?? "",
      color: team?.color ?? BRAND_DEFAULT,
      holidayCalendarId: String(team?.holidayCalendarId ?? companyCalendar?.id ?? ""),
      memberIds: team?.members.map((m) => m.id) ?? [],
    },
    validators: {
      onChange: z.object({
        name: z.string().trim().min(1, "errors.fields.required").max(120, "errors.fields.too_long"),
        color: z.string().regex(/^#[0-9a-f]{6}$/, "errors.fields.invalid"),
        holidayCalendarId: z.string(),
        memberIds: z.array(z.number()),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value)
      } catch (err) {
        if (!applyServerErrors(formApi, err)) toast.error(tError(err))
      }
    },
  })
  if (teamId != null && !team) return null
  return (
    <EditorSheet
      open
      size="md"
      onOpenChange={(o) => !o && onClose()}
      title={team ? team.name : t("admin.teams.new")}
      footer={
        <>
          {team ? (
            <Button
              intent="negative"
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              {t("common.delete")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{team ? t("common.save") : t("common.create")}</SheetSubmit>
        </>
      }
    >
      <div className="flex flex-col gap-8">
        <form.AppForm>
          <FormRoot form={form} className="flex flex-col gap-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="name">
                {(f) => <f.TextField label={t("common.name")} autoComplete="off" />}
              </form.AppField>
              <form.Field name="color">
                {(field) => (
                  <Field className="sm:col-span-2">
                    <FieldLabel id={teamColorId}>{t("admin.teams.color")}</FieldLabel>
                    <ColorPicker
                      value={field.state.value}
                      onChange={field.handleChange}
                      aria-labelledby={teamColorId}
                    />
                  </Field>
                )}
              </form.Field>
              <div className="sm:col-span-2">
                <form.AppField name="holidayCalendarId">
                  {(f) => (
                    <f.ComboboxField
                      label={t("admin.teams.calendar")}
                      options={refs.calendars.map((c) => ({
                        value: String(c.id),
                        label: c.name,
                        badge: c.isDefault ? (
                          <StatusBadge tone="brand" className="shrink-0">
                            {t("admin.holidays.default")}
                          </StatusBadge>
                        ) : undefined,
                      }))}
                    />
                  )}
                </form.AppField>
              </div>
            </div>
            <form.Field name="memberIds">
              {(field) => (
                <FormGroup title={`${t("admin.teams.members")} · ${field.state.value.length}`}>
                  <MemberPicker
                    teamId={teamId}
                    teams={teams}
                    people={refs.people.filter((p) => p.isActive)}
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                </FormGroup>
              )}
            </form.Field>
          </FormRoot>
        </form.AppForm>
        {team ? <LeadsEditor team={team} /> : null}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("admin.teams.delete_title", { name: team?.name ?? "" })}
        description={t("admin.teams.delete_message")}
        confirmLabel={t("common.delete")}
        onConfirm={() => (teamId == null ? undefined : remove.mutateAsync(teamId))}
      />
    </EditorSheet>
  )
}

function MemberPicker({
  teamId,
  teams,
  people,
  value,
  onChange,
}: {
  teamId: number | null
  teams: TeamRow[]
  people: { id: number; name: string; email: string; teamId: number | null }[]
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const { t } = useI18n()
  const selected = new Set(value)
  const teamName = new Map(teams.map((x) => [x.id, x.name]))
  // members first, in the order they had when the sheet opened (no jumping while toggling)
  const [initial] = useState(() => new Set(value))
  const sorted = [...people].sort(
    (a, b) => Number(initial.has(b.id)) - Number(initial.has(a.id)) || a.name.localeCompare(b.name),
  )
  const toggle = (id: number) => onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <Command className="rounded-lg border">
      <CommandInput placeholder={t("common.search_person")} />
      {/* fixed height (every 2rem row, capped) so filtering never resizes the box */}
      <CommandList className="max-h-none min-h-17" style={{ height: `min(16rem, ${people.length * 2 + 0.5}rem)` }}>
        <CommandEmpty>{t("common.no_matches")}</CommandEmpty>
        <CommandGroup>
          {sorted.map((p) => {
            const on = selected.has(p.id)
            const from = p.teamId != null && p.teamId !== teamId ? teamName.get(p.teamId) : null
            return (
              <CommandItem key={p.id} value={`${p.name} ${p.email}`} onSelect={() => toggle(p.id)} aria-selected={on}>
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                    on && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {on ? <Check className="size-3" /> : null}
                </span>
                <span className="truncate">{p.name}</span>
                {from ? (
                  <CommandHint className={cn("shrink truncate", on && "text-warning")}>
                    {on ? t("admin.teams.moves_from", { team: from }) : from}
                  </CommandHint>
                ) : null}
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function LeadsEditor({ team }: { team: TeamRow }) {
  const leadFromId = useId()
  const leadPersonId = useId()
  const leadRoleId = useId()
  const leadToId = useId()
  const { t, intl } = useI18n()
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  const [userId, setUserId] = useState<string | null>(null)
  const [role, setRole] = useState<(typeof LEAD_ROLES)[number]>(
    team.leads.some((l) => l.role === "lead") ? "deputy" : "lead",
  )
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const add = useAction(
    (v: { userId: number; role: "lead" | "deputy"; validFrom: string | null; validTo: string | null }) =>
      addLeadFn({ data: { teamId: team.id, ...v } }),
    { success: t("admin.teams.lead_added") },
  )
  const readd = useAction(
    (v: { userId: number; role: "lead" | "deputy"; validFrom: string | null; validTo: string | null }) =>
      addLeadFn({ data: { teamId: team.id, ...v } }),
  )
  const remove = useAction((l: TeamRow["leads"][number]) => removeLeadFn({ data: { id: l.id } }), {
    onSuccess: (_r, l) =>
      undoToast(t("admin.teams.lead_removed", { name: l.name }), t("common.undo"), () =>
        readd.mutate({ userId: l.userId, role: l.role, validFrom: l.validFrom, validTo: l.validTo }),
      ),
  })
  const badPeriod = from && to && to < from
  return (
    <FormGroup title={t("admin.teams.leads_and_deputies")}>
      {team.leads.length ? (
        <ul className="divide-y rounded-lg border">
          {team.leads.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-medium", !l.active && "text-muted-foreground")}>{l.name}</p>
                <p className="text-xs text-muted-foreground">{fmtPeriod(l.validFrom, l.validTo, intl, t)}</p>
              </div>
              <StatusBadge tone={l.role === "lead" ? "brand" : "info"}>
                {t(l.role === "lead" ? "admin.teams.role_lead" : "admin.teams.role_deputy")}
              </StatusBadge>
              <Button
                intent="negative"
                variant="ghost"
                size="icon-sm"
                onClick={() => remove.mutate(l)}
                aria-label={t("admin.teams.remove_lead", { name: l.name })}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("admin.teams.no_lead_help")}</p>
      )}
      <div className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={leadPersonId}>{t("admin.teams.person")}</FieldLabel>
          <Combobox
            id={leadPersonId}
            value={userId}
            onChange={setUserId}
            placeholder={t("admin.teams.pick_person")}
            options={refs.people
              .filter((p) => p.isActive)
              .map((p) => ({ value: String(p.id), label: p.name, hint: p.email }))}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel id={leadRoleId}>{t("common.role")}</FieldLabel>
          <Segmented
            value={role}
            onValueChange={setRole}
            aria-labelledby={leadRoleId}
            fill
            options={LEAD_ROLES.map((r) => ({ value: r, label: t(`admin.teams.role_${r}`) }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={leadFromId}>{t("common.from")}</FieldLabel>
          <DatePicker id={leadFromId} value={from} onChange={setFrom} />
        </Field>
        <Field data-invalid={badPeriod ? true : undefined}>
          <FieldLabel htmlFor={leadToId}>{t("common.to")}</FieldLabel>
          <DatePicker id={leadToId} value={to} min={from || undefined} onChange={setTo} invalid={Boolean(badPeriod)} />
        </Field>
        <div className="sm:col-span-2">
          <Button
            variant="outline"
            disabled={add.isPending}
            onClick={() => {
              if (!userId) {
                toast.error(t("admin.teams.pick_person"))
                return
              }
              if (badPeriod) {
                toast.error(t("errors.fields.before_start"))
                return
              }
              add.mutate(
                { userId: Number(userId), role, validFrom: from || null, validTo: to || null },
                {
                  onSuccess: () => {
                    setUserId(null)
                    setFrom("")
                    setTo("")
                  },
                },
              )
            }}
          >
            {t("admin.teams.add_lead")}
          </Button>
        </div>
      </div>
    </FormGroup>
  )
}
