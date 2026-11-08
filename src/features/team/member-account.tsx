/**
 * A member's account for their lead/HR: balance, vacation and Überzeit of a year, balance adjustments
 * (create/delete with a logged reason) and the vacation entitlement override, when allowed (`canAdjust`).
 */
import { useQueryClient, useSuspenseQueries } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { Section } from "@/components/app/page"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { ReasonDialog } from "@/components/app/reason-dialog"
import { ResponsiveDialog } from "@/components/app/responsive-dialog"
import { Segmented } from "@/components/app/segmented"
import { DataTable } from "@/components/data/data-table"
import { Duration } from "@/components/data/duration"
import { StatCard, StatGrid } from "@/components/data/stat"
import { tableHelper } from "@/components/data/table-helper"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { accountQuery, createAdjustmentFn, deleteAdjustmentFn, setEntitlementFn } from "@/features/accounts/api"
import { SheetSubmit } from "@/features/admin/ui"
import { OvertimeMeter } from "@/features/reports/compliance-preview"
import { todayIn } from "@/features/time/lib"
import { failure } from "@/lib/attempt"
import { fmtDay, fmtDays, fmtMinutes } from "@/lib/format"

import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { AdjustmentItem } from "@/server/services/accounts"
import { adjustmentsQuery } from "./api"

const col = tableHelper<AdjustmentItem>()
const AFFECTED = [["account"], ["team"], ["time"], ["absences"], ["reports"]]

function useRefresh() {
  const qc = useQueryClient()
  return () => Promise.all(AFFECTED.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

/** "+1:30", "-0:45", "2" (hours) → minutes; null when unreadable or zero. */
function parseSignedHours(text: string): number | null {
  const s = text.trim().replace("−", "-").replace(",", ".")
  const m = s.match(/^([+-]?)(\d{1,4})(?::([0-5]\d))?$/) ?? s.match(/^([+-]?)(\d{1,4}\.\d+)()$/)
  if (!m) return null
  const sign = m[1] === "-" ? -1 : 1
  const min = m[3] !== undefined && m[3] !== "" ? Number(m[2]) * 60 + Number(m[3]) : Math.round(Number(m[2]) * 60)
  return min ? sign * min : null
}

export function AccountPanel({ userId }: { userId: number }) {
  const { t, intl } = useI18n()
  const me = useMe()
  const thisYear = Number(todayIn(me.timezone).slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [pending, startTransition] = useTransition()
  // both at once: the account no longer has to answer before the adjustments are requested
  const [{ data: a }, { data: items }] = useSuspenseQueries({
    queries: [accountQuery({ userId, year }), adjustmentsQuery(userId, year)],
  })
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<AdjustmentItem | null>(null)
  const [entitlement, setEntitlement] = useState(false)
  const columns = [
    col.accessor("effectiveDate", {
      header: () => t("account.effective"),
      meta: { primary: true, className: "whitespace-nowrap" },
      cell: (c) => fmtDay(c.getValue(), intl, { day: "numeric", month: "short", year: "numeric" }),
    }),
    col.accessor("kind", {
      header: () => t("account.kind_label"),
      meta: { mobileLabel: t("account.kind_label") },
      cell: (c) => t(`account.kind.${c.getValue()}`),
    }),
    col.accessor("amount", {
      header: () => t("member.amount"),
      meta: { numeric: true, mobileLabel: t("member.amount") },
      cell: (c) =>
        c.row.original.account === "time" ? (
          <Duration minutes={c.getValue()} balance />
        ) : (
          <span className="tabular">
            {c.getValue() > 0 ? "+" : ""}
            {fmtDays(c.getValue())} {t("common.days")}
          </span>
        ),
    }),
    col.accessor("reason", {
      header: () => t("common.reason"),
      enableSorting: false,
      meta: { mobileLabel: t("common.reason"), className: "max-w-80 truncate text-muted-foreground" },
    }),
    col.accessor((r) => r.createdBy ?? "", { id: "by", header: () => t("member.by"), meta: { hideOnMobile: true } }),
    col.display({
      id: "remove",
      header: () => <span className="sr-only">{t("common.delete")}</span>,
      meta: { className: "w-12" },
      cell: (c) =>
        a.canAdjust ? (
          <Button
            intent="negative"
            variant="ghost"
            size="icon-sm"
            aria-label={t("member.remove_adjustment")}
            onClick={() => setRemoving(c.row.original)}
          >
            <Trash2 />
          </Button>
        ) : null,
    }),
  ]
  const v = a.vacation
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <PeriodNav
          label={String(a.year)}
          onPrev={() => setYear(a.year - 1)}
          onNext={() => setYear(a.year + 1)}
          canPrev={a.year > a.firstYear}
          canNext={a.year <= thisYear}
          startTransition={startTransition}
        />
      </div>
      <PeriodContent className={cn("flex flex-col gap-6", pending && "opacity-60 transition-opacity")}>
        <StatGrid>
          <StatCard
            label={t("account.opening")}
            value={<Duration minutes={a.statement.openingMin} balance />}
            hint={t("account.opening_hint", { prev: a.year - 1 })}
          />
          <StatCard
            label={t("member.adjustments_year", { year: a.year })}
            value={
              <Duration
                minutes={items.filter((x) => x.account === "time").reduce((sum, x) => sum + x.amount, 0)}
                balance
              />
            }
          />
          <StatCard
            label={t("member.entitlement_year", { year: a.year })}
            value={fmtDays(v.entitlement)}
            unit={t("common.days")}
            hint={t("member.entitlement_hint", { carried: fmtDays(v.carriedOver), taken: fmtDays(v.taken) })}
          >
            {a.canAdjust ? (
              <Button
                variant="link"
                size="sm"
                className="mt-1 h-auto self-start p-0"
                onClick={() => setEntitlement(true)}
              >
                <Pencil data-icon="inline-start" />
                {t("common.edit")}
              </Button>
            ) : null}
          </StatCard>
          <StatCard label={t("compliance.ueberzeit_year", { year: a.year })} value={fmtMinutes(a.overtime.overtimeMin)}>
            <OvertimeMeter
              o={{
                year: a.year,
                weeklyMaxHours: a.overtime.weeklyMaxHours,
                overtimeMin: a.overtime.overtimeMin,
                limitMin: a.overtime.limitMin,
                warnAtMin: a.overtime.warnAtMin,
              }}
            />
          </StatCard>
        </StatGrid>
        <Section
          title={t("account.adjustments")}
          actions={
            a.canAdjust ? (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <Plus data-icon="inline-start" />
                {t("account.add_adjustment")}
              </Button>
            ) : null
          }
        >
          <DataTable
            data={items}
            columns={columns}
            getRowId={(r) => `${r.account}-${r.id}`}
            empty={t("account.no_adjustments")}
          />
        </Section>
      </PeriodContent>
      {adding ? <AdjustmentDialog userId={userId} name={a.user.name} onClose={() => setAdding(false)} /> : null}
      {removing ? <RemoveDialog item={removing} onClose={() => setRemoving(null)} /> : null}
      {entitlement ? (
        <EntitlementDialog
          userId={userId}
          year={a.year}
          days={v.entitlementOverridden ? v.entitlement : null}
          onClose={() => setEntitlement(false)}
        />
      ) : null}
    </div>
  )
}

function AdjustmentDialog({ userId, name, onClose }: { userId: number; name: string; onClose: () => void }) {
  const accountLabelId = useId()
  const { t, tError } = useI18n()
  const refresh = useRefresh()
  const form = useAppForm({
    defaultValues: {
      account: "time" as "time" | "vacation",
      kind: "correction" as "opening" | "payout" | "correction",
      amount: "",
      effectiveDate: "",
      reason: "",
    },
    validators: {
      onChange: z
        .object({
          account: z.enum(["time", "vacation"]),
          kind: z.enum(["opening", "payout", "correction"]),
          amount: z.string().min(1, "errors.fields.required"),
          effectiveDate: z.string(),
          reason: z.string().trim().min(1, "errors.fields.required").max(500, "errors.fields.too_long"),
        })
        .superRefine((v, ctx) => {
          const ok =
            v.account === "time"
              ? parseSignedHours(v.amount) != null
              : Number.isFinite(Number(v.amount.replace(",", "."))) && Number(v.amount.replace(",", ".")) !== 0
          if (v.amount && !ok) ctx.addIssue({ code: "custom", path: ["amount"], message: "errors.fields.invalid" })
        }),
    },
    onSubmit: async ({ value, formApi }) => {
      const amount = value.account === "time" ? parseSignedHours(value.amount) : Number(value.amount.replace(",", "."))
      if (amount == null) return
      const effectiveDate = value.effectiveDate || null
      const failed = await failure(
        createAdjustmentFn({
          data: { userId, account: value.account, kind: value.kind, amount, effectiveDate, reason: value.reason },
        }).then(refresh),
      )
      if (failed) {
        if (!applyServerErrors(formApi, failed.error)) toast.error(tError(failed.error))
        return
      }
      toast.success(t("member.adjusted"))
      onClose()
    },
  })
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("account.add_adjustment")}
      description={t("account.adjust_for", { name })}
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
          <form.Field name="account">
            {(f) => (
              <Field>
                <FieldLabel id={accountLabelId}>{t("member.account")}</FieldLabel>
                <Segmented
                  value={f.state.value}
                  onValueChange={f.handleChange}
                  aria-labelledby={accountLabelId}
                  fill
                  options={[
                    { value: "time", label: t("account.time_account") },
                    { value: "vacation", label: t("account.vacation") },
                  ]}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.values.account}>
            {(account) => (
              <div className="grid grid-cols-2 gap-4">
                <form.AppField name="amount">
                  {(f) => (
                    <f.TextField
                      label={account === "time" ? t("account.amount_hours") : t("account.amount_days")}
                      placeholder={account === "time" ? "+1:30" : "-1.5"}
                      inputMode="text"
                      autoComplete="off"
                      className="tabular"
                    />
                  )}
                </form.AppField>
                <form.AppField name="effectiveDate">
                  {(f) => <f.DateField label={t("account.effective")} description={t("member.effective_help")} />}
                </form.AppField>
              </div>
            )}
          </form.Subscribe>
          <form.AppField name="kind">
            {(f) => (
              <f.SelectField
                label={t("account.kind_label")}
                options={(["correction", "payout", "opening"] as const).map((k) => ({
                  value: k,
                  label: t(`account.kind.${k}`),
                }))}
              />
            )}
          </form.AppField>
          <form.AppField name="reason">
            {(f) => (
              <f.TextareaField label={t("common.reason")} description={t("member.reason_logged")} maxLength={500} />
            )}
          </form.AppField>
        </FormRoot>
      </form.AppForm>
    </ResponsiveDialog>
  )
}

function RemoveDialog({ item, onClose }: { item: AdjustmentItem; onClose: () => void }) {
  const { t } = useI18n()
  const refresh = useRefresh()
  return (
    <ReasonDialog
      title={t("account.remove_adjustment")}
      submitLabel={t("common.delete")}
      rows={2}
      onClose={onClose}
      onSubmit={async (reason) => {
        await deleteAdjustmentFn({ data: { id: item.id, reason } })
        await refresh()
        toast.success(t("member.adjustment_removed"))
      }}
    />
  )
}

function EntitlementDialog({
  userId,
  year,
  days,
  onClose,
}: {
  userId: number
  year: number
  days: number | null
  onClose: () => void
}) {
  const { t, tError } = useI18n()
  const refresh = useRefresh()
  const form = useAppForm({
    defaultValues: { days: days == null ? "" : String(days), note: "" },
    validators: {
      onChange: z.object({
        days: z
          .string()
          .refine(
            (v) =>
              v.trim() === "" ||
              (Number.isFinite(Number(v.replace(",", "."))) &&
                Number(v.replace(",", ".")) >= 0 &&
                Number(v.replace(",", ".")) <= 366),
            "errors.fields.invalid",
          ),
        note: z.string().max(500, "errors.fields.too_long"),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      const entitled = value.days.trim() === "" ? null : Number(value.days.replace(",", "."))
      const failed = await failure(
        setEntitlementFn({ data: { userId, year, days: entitled, note: value.note } }).then(refresh),
      )
      if (failed) {
        if (!applyServerErrors(formApi, failed.error)) toast.error(tError(failed.error))
        return
      }
      toast.success(t("common.saved"))
      onClose()
    },
  })
  return (
    <ResponsiveDialog
      open
      variant="dialog"
      onOpenChange={(o) => !o && onClose()}
      title={t("account.entitlement_override", { year })}
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
          <form.AppField name="days">
            {(f) => (
              <f.TextField
                label={t("account.amount_days")}
                inputMode="decimal"
                description={t("account.entitlement_help")}
              />
            )}
          </form.AppField>
          <form.AppField name="note">
            {(f) => <f.TextareaField label={t("common.note")} maxLength={500} />}
          </form.AppField>
        </FormRoot>
      </form.AppForm>
    </ResponsiveDialog>
  )
}
