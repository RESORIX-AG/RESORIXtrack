import { CalendarPlus } from "lucide-react"
import { useState } from "react"
import { z } from "zod"
import { Section } from "@/components/app/page"
import { undoToast } from "@/components/app/undo-toast"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Button } from "@/components/ui/button"
import { fmtDays } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { UserDetail } from "@/server/services/users"
import { setEntitlementFn } from "../api/users"
import { currentYear } from "../lib"
import { EditorSheet, SheetSubmit, useAction } from "../ui"

type Entitlement = UserDetail["entitlements"][number]
const col = tableHelper<Entitlement>()

export function VacationPanel({ user }: { user: UserDetail }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<Entitlement | "new" | null>(null)
  const columns = [
    col.accessor("year", { header: () => t("common.year"), meta: { primary: true } }),
    col.accessor("days", {
      header: () => t("admin.vacation.days"),
      meta: { numeric: true, mobileLabel: t("admin.vacation.days") },
      cell: (c) => fmtDays(c.getValue()),
    }),
    col.accessor("note", {
      header: () => t("common.note"),
      enableSorting: false,
      meta: { className: "text-muted-foreground", mobileLabel: t("common.note") },
    }),
  ]
  return (
    <Section
      title={t("admin.vacation.title")}
      description={t("admin.vacation.default_days", { days: fmtDays(user.vacationDaysPerYear) })}
      actions={
        <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={user.anonymizedAt != null}>
          <CalendarPlus data-icon="inline-start" />
          {t("admin.vacation.add")}
        </Button>
      }
    >
      <DataTable
        data={user.entitlements}
        columns={columns}
        getRowId={(r) => String(r.id)}
        initialSorting={[{ id: "year", desc: true }]}
        onRowClick={(r) => setEditing(r)}
        empty={t("admin.vacation.empty")}
      />
      {editing ? (
        <EntitlementSheet user={user} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </Section>
  )
}

function EntitlementSheet({
  user,
  entry,
  onClose,
}: {
  user: UserDetail
  entry: Entitlement | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const save = useAction(
    (v: { year: number; days: number | null; note: string }) => setEntitlementFn({ data: { id: user.id, ...v } }),
    {
      success: t("common.saved"),
      onSuccess: onClose,
    },
  )
  const restore = useAction((v: { year: number; days: number; note: string }) =>
    setEntitlementFn({ data: { id: user.id, ...v } }),
  )
  const remove = useAction(
    (e: Entitlement) => setEntitlementFn({ data: { id: user.id, year: e.year, days: null, note: "" } }),
    {
      onSuccess: (_, e) => {
        onClose()
        undoToast(t("admin.vacation.removed"), t("common.undo"), () =>
          restore.mutate({ year: e.year, days: e.days, note: e.note }),
        )
      },
    },
  )
  const form = useAppForm({
    defaultValues: {
      year: entry?.year ?? currentYear() + 1,
      days: entry?.days ?? user.vacationDaysPerYear,
      note: entry?.note ?? "",
    },
    validators: {
      onChange: z.object({
        year: z
          .number({ error: "errors.fields.required" })
          .int()
          .min(1990, "errors.fields.invalid")
          .max(2100, "errors.fields.invalid"),
        days: z
          .number({ error: "errors.fields.required" })
          .min(0, "errors.fields.invalid")
          .max(366, "errors.fields.invalid"),
        note: z.string().max(200, "errors.fields.too_long"),
      }),
    },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value).catch(() => undefined)
    },
  })
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={entry ? t("admin.vacation.edit", { year: entry.year }) : t("admin.vacation.add")}
      footer={
        <>
          {entry ? (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => remove.mutate(entry)}>
              {t("admin.vacation.reset")}
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
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="year">
              {(f) => (
                <f.TextField label={t("common.year")} type="number" min={1990} max={2100} disabled={entry != null} />
              )}
            </form.AppField>
            <form.AppField name="days">
              {(f) => <f.TextField label={t("admin.vacation.days")} type="number" min={0} max={366} step={0.5} />}
            </form.AppField>
          </div>
          <form.AppField name="note">
            {(f) => (
              <f.TextareaField
                label={t("common.note")}
                placeholder={t("admin.vacation.note_placeholder")}
                maxLength={500}
              />
            )}
          </form.AppField>
        </FormRoot>
      </form.AppForm>
    </EditorSheet>
  )
}
