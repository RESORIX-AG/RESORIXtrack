import { useSuspenseQuery } from "@tanstack/react-query"
import { Check, Minus, Plus } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConfirmDialog } from "@/components/app/confirm"
import { Section } from "@/components/app/page"
import { ColorDot, StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { ColorPicker } from "@/components/ui/color-picker"
import { Field, FieldLabel } from "@/components/ui/field"
import { useI18n } from "@/lib/i18n"
import type { listAbsenceTypesAdmin } from "@/server/services/admin-settings"
import { absenceTypesAdminQuery, deleteAbsenceTypeFn, saveAbsenceTypeFn } from "../api/settings"
import { EditorSheet, SheetSubmit, useAction } from "../ui"

type Row = ReturnType<typeof listAbsenceTypesAdmin>[number]
const FLAGS = ["requiresApproval", "employeeCanRequest", "allowsAttachments", "creditsTime", "deductsVacation"] as const
/** Fixed once a type is in use: past absences were counted by them. */
const COUNTING = new Set<string>(["creditsTime", "deductsVacation"])
const col = tableHelper<Row>()

function Flag({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <Check className="size-4 text-positive" aria-label={label} />
  ) : (
    <Minus className="size-4 text-muted-foreground/50" aria-label={`${label}: –`} />
  )
}

export function AbsenceTypesSection() {
  const { t, absenceLabel } = useI18n()
  const { data } = useSuspenseQuery(absenceTypesAdminQuery)
  const [editing, setEditing] = useState<Row | "new" | null>(null)
  const columns = [
    col.accessor((r) => absenceLabel(r), {
      id: "label",
      header: () => t("admin.types.type"),
      meta: { primary: true },
      cell: (c) => (
        <span className="flex items-center gap-2.5">
          <ColorDot color={c.row.original.color} />
          <span className="font-medium">{c.getValue()}</span>
          <span className="font-mono text-xs text-muted-foreground">{c.row.original.key}</span>
        </span>
      ),
    }),
    col.accessor("category", {
      header: () => t("admin.types.category"),
      meta: { mobileLabel: t("admin.types.category") },
      cell: (c) => t(`admin.types.categories.${c.getValue()}`),
    }),
    ...FLAGS.map((f) =>
      col.accessor(f, {
        header: () => t(`admin.types.flags.${f}`),
        enableSorting: false,
        meta: { hideOnMobile: true, className: "text-center w-24 whitespace-normal" },
        cell: (c) => (
          <span className="flex justify-center">
            <Flag on={c.getValue()} label={t(`admin.types.flags.${f}`)} />
          </span>
        ),
      }),
    ),
    col.accessor("isActive", {
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) =>
        c.getValue() ? (
          <StatusBadge tone="positive">{t("common.active")}</StatusBadge>
        ) : (
          <StatusBadge>{t("common.inactive")}</StatusBadge>
        ),
    }),
  ]
  return (
    <Section
      title={t("admin.types.title")}
      actions={
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus data-icon="inline-start" />
          {t("admin.types.new")}
        </Button>
      }
    >
      <DataTable data={data} columns={columns} getRowId={(r) => String(r.id)} onRowClick={(r) => setEditing(r)} />
      {editing ? (
        <TypeSheet
          row={editing === "new" ? null : editing}
          nextSort={(data.at(-1)?.sort ?? 0) + 10}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  )
}

function TypeSheet({ row, nextSort, onClose }: { row: Row | null; nextSort: number; onClose: () => void }) {
  const typeColorId = useId()
  const { t, tError, absenceLabel } = useI18n()
  const [confirm, setConfirm] = useState(false)
  const save = useAction(
    (v: Values) => {
      const { key, ...input } = v
      return saveAbsenceTypeFn({ data: { id: row?.id ?? null, key, input: { ...input, label: input.label.trim() } } })
    },
    { success: t("common.saved"), silentError: true, onSuccess: onClose },
  )
  const remove = useAction((id: number) => deleteAbsenceTypeFn({ data: { id } }), {
    success: t("admin.types.deleted"),
    onSuccess: onClose,
  })
  const inUse = (row?.usage ?? 0) > 0
  type Values = Omit<Row, "id" | "usage">
  const defaults: Values = {
    key: row?.key ?? "",
    label: row?.label ?? "",
    color: row?.color ?? "#8a8d93",
    category: row?.category ?? "other",
    creditsTime: row?.creditsTime ?? true,
    deductsVacation: row?.deductsVacation ?? false,
    requiresApproval: row?.requiresApproval ?? true,
    allowsAttachments: row?.allowsAttachments ?? false,
    employeeCanRequest: row?.employeeCanRequest ?? true,
    isActive: row?.isActive ?? true,
    sort: row?.sort ?? nextSort,
  }
  const form = useAppForm({
    defaultValues: defaults,
    validators: {
      onChange: z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, "admin.types.key_invalid"),
        label: z.string().trim().min(1, "errors.fields.required").max(80, "errors.fields.too_long"),
        color: z.string().regex(/^#[0-9a-f]{6}$/),
        category: z.enum(["vacation", "sick", "other"]),
        creditsTime: z.boolean(),
        deductsVacation: z.boolean(),
        requiresApproval: z.boolean(),
        allowsAttachments: z.boolean(),
        employeeCanRequest: z.boolean(),
        isActive: z.boolean(),
        sort: z.number({ error: "errors.fields.required" }).int().min(0).max(10000),
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
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? absenceLabel(row) : t("admin.types.new")}
      footer={
        <>
          {row && row.usage === 0 ? (
            <Button
              intent="negative"
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => setConfirm(true)}
            >
              {t("common.delete")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{t("common.save")}</SheetSubmit>
        </>
      }
    >
      <form.AppForm>
        <FormRoot form={form}>
          <div className="grid grid-cols-[1fr_auto] gap-4">
            <form.AppField name="label">
              {(f) => (
                <f.TextField
                  label={t("admin.types.label")}
                  description={row && absenceLabel(row) !== row.label ? t("admin.types.label_help") : undefined}
                />
              )}
            </form.AppField>
            <form.Field name="color">
              {(field) => (
                <Field className="col-span-full">
                  <FieldLabel id={typeColorId}>{t("admin.teams.color")}</FieldLabel>
                  <ColorPicker value={field.state.value} onChange={field.handleChange} aria-labelledby={typeColorId} />
                </Field>
              )}
            </form.Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="key">
              {(f) => (
                <f.TextField
                  label={t("admin.types.key")}
                  disabled={row != null}
                  className="font-mono"
                  description={row ? undefined : t("admin.types.key_help")}
                />
              )}
            </form.AppField>
            <form.AppField name="category">
              {(f) => (
                <f.SelectField
                  label={t("admin.types.category")}
                  disabled={inUse}
                  description={inUse ? t("admin.types.counting_locked") : undefined}
                  options={(["vacation", "sick", "other"] as const).map((c) => ({
                    value: c,
                    label: t(`admin.types.categories.${c}`),
                  }))}
                />
              )}
            </form.AppField>
          </div>
          <div className="flex flex-col gap-3">
            {FLAGS.map((f) => (
              <form.AppField key={f} name={f}>
                {(fl) => (
                  <fl.SwitchField label={t(`admin.types.flags_long.${f}`)} disabled={inUse && COUNTING.has(f)} />
                )}
              </form.AppField>
            ))}
            <form.AppField name="isActive">{(f) => <f.SwitchField label={t("common.active")} />}</form.AppField>
          </div>
          <form.AppField name="sort">
            {(f) => <f.TextField label={t("admin.types.sort")} type="number" min={0} max={10000} className="w-28" />}
          </form.AppField>
        </FormRoot>
      </form.AppForm>
      {row ? (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("admin.types.delete_title", { name: absenceLabel(row) })}
          confirmLabel={t("common.delete")}
          onConfirm={() => remove.mutateAsync(row.id)}
        />
      ) : null}
    </EditorSheet>
  )
}
