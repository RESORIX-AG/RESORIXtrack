/**
 * The time account of a year: the current balance, the monthly statement (table + running-balance chart),
 * the vacation account, adjustments and the Überzeit tally against the legal limit.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Section } from "@/components/app/page"
import { PeriodContent, PeriodNav } from "@/components/app/period-nav"
import { StatusBadge } from "@/components/app/status-badge"
import { BalanceChart } from "@/components/data/charts"
import { DataTable } from "@/components/data/data-table"
import { Duration } from "@/components/data/duration"
import { StatCard, StatGrid } from "@/components/data/stat"
import { tableHelper } from "@/components/data/table-helper"
import { ButtonLink } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtDay, fmtDays, fmtMinutes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { AdjustmentItem, StatementMonth } from "@/server/services/accounts"
import { accountQuery } from "./api"

const col = tableHelper<StatementMonth>()

function monthName(m: number, intl: string, style: "long" | "short" = "long") {
  return new Intl.DateTimeFormat(intl, { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 15)))
}

export function AccountView({
  userId,
  year,
  onYear,
}: {
  userId?: number | null
  year?: number
  onYear: (year: number | undefined) => void
}) {
  const { t, intl } = useI18n()
  const q = useQuery({ ...accountQuery({ userId, year }), placeholderData: keepPreviousData })
  const data = q.data
  const months0 = data?.statement.months ?? []
  const credit = (k: "surchargeMin" | "nightCreditMin", header: string) =>
    months0.some((m) => m[k] > 0)
      ? [
          col.accessor(k, {
            header: () => header,
            meta: { numeric: true, hideOnMobile: true },
            cell: (c) => <span className="text-muted-foreground">{c.getValue() ? fmtMinutes(c.getValue()) : "–"}</span>,
          }),
        ]
      : []
  const columns = [
    col.accessor("month", {
      header: () => t("common.month"),
      meta: { primary: true, mobileLabel: t("common.month") },
      cell: (c) => <span className="font-medium">{monthName(c.getValue(), intl)}</span>,
    }),
    col.accessor("workdays", { header: () => t("account.workdays"), meta: { numeric: true, hideOnMobile: true } }),
    col.accessor("targetMin", {
      header: () => t("time.target"),
      meta: { numeric: true, mobileLabel: t("time.target") },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    col.accessor("workedMin", {
      header: () => t("time.worked"),
      meta: { numeric: true, mobileLabel: t("time.worked") },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    col.accessor("creditMin", {
      header: () => t("account.credits_col"),
      meta: { numeric: true, hideOnMobile: true },
      cell: (c) => <span className="text-muted-foreground">{c.getValue() ? fmtMinutes(c.getValue()) : "–"}</span>,
    }),
    ...credit("surchargeMin", t("account.surcharge_col")),
    ...credit("nightCreditMin", t("account.night_credit_col")),
    col.accessor("deltaMin", {
      header: () => t("time.delta"),
      meta: { numeric: true, mobileLabel: t("time.delta") },
      cell: (c) => <Duration minutes={c.getValue()} balance />,
    }),
    col.accessor("adjustmentsMin", {
      header: () => t("account.adjustments"),
      meta: { numeric: true, hideOnMobile: true },
      cell: (c) =>
        c.getValue() ? <Duration minutes={c.getValue()} balance /> : <span className="text-muted-foreground">–</span>,
    }),
    col.accessor("balanceMin", {
      header: () => t("account.balance"),
      meta: { numeric: true, mobileLabel: t("account.balance") },
      cell: (c) => <Duration minutes={c.getValue()} balance className="font-semibold" />,
    }),
  ]

  if (!data) return <AccountSkeleton />
  const st = data.statement
  const v = data.vacation
  const ot = data.overtime
  const months = st.months
  const sum = (k: "targetMin" | "workedMin" | "creditMin") => months.reduce((a, m) => a + m[k], 0)
  const thisYear = Number(data.balance.asOf.slice(0, 4))
  const adjustments: AdjustmentItem[] = [...st.adjustments, ...v.adjustmentItems].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate),
  )
  const otPct = ot.limitMin ? ot.overtimeMin / ot.limitMin : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <PeriodNav
          label={String(data.year)}
          onPrev={() => onYear(data.year - 1)}
          onNext={() => onYear(data.year + 1 === thisYear ? undefined : data.year + 1)}
          onToday={() => onYear(undefined)}
          isCurrent={data.year === thisYear}
          canPrev={data.year > data.firstYear}
          canNext={data.year <= thisYear}
        />
      </div>

      <PeriodContent className={cn("flex flex-col gap-6", q.isPlaceholderData && "opacity-60")}>
        <StatGrid>
          <StatCard
            label={t("account.balance")}
            value={<Duration minutes={data.year === thisYear ? data.balance.balanceMin : st.closingMin} balance />}
            hint={
              data.year === thisYear
                ? t("dashboard.balance_hint", { date: fmtDay(data.balance.asOf, intl) })
                : t("account.closing_of", { year: data.year })
            }
            className="bg-gradient-hero"
          />
          <StatCard
            label={t("account.opening")}
            value={<Duration minutes={st.openingMin} balance />}
            hint={t("account.opening_hint", { prev: data.year - 1 })}
          />
          <StatCard
            label={t("account.target_year")}
            value={fmtMinutes(sum("targetMin"))}
            hint={t("account.until_yesterday")}
          />
          <StatCard
            label={t("account.worked_year")}
            value={fmtMinutes(sum("workedMin"))}
            hint={sum("creditMin") ? t("account.credits", { t: fmtMinutes(sum("creditMin")) }) : undefined}
          />
        </StatGrid>

        <Section title={t("account.statement")}>
          {months.length ? (
            <div className="rounded-xl border bg-card p-4 sm:p-5">
              <BalanceChart
                points={months.map((m) => ({ label: monthName(m.month, intl, "short"), minutes: m.balanceMin }))}
                ariaLabel={t("account.balance_chart")}
              />
            </div>
          ) : null}
          <DataTable
            data={months}
            columns={columns}
            getRowId={(m) => String(m.month)}
            caption={t("account.statement")}
            empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("account.no_months")}</p>}
          />
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section
            title={t("account.vacation")}
            actions={
              <ButtonLink variant="link" size="sm" className="h-auto px-0" render={<Link to="/absences" />}>
                {t("account.to_absences")}
              </ButtonLink>
            }
          >
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Figure label={t("account.carried_over")} value={fmtDays(v.carriedOver)} />
              <Figure
                label={t("account.entitlement")}
                value={`${fmtDays(v.entitlement)}${v.entitlementOverridden ? " *" : ""}`}
              />
              <Figure label={t("account.adjustments")} value={fmtDays(v.adjustments)} />
              <Figure label={t("account.taken")} value={fmtDays(v.taken)} />
              <Figure label={t("account.planned")} value={fmtDays(v.planned)} />
              <Figure label={t("account.pending")} value={fmtDays(v.pending)} />
              <Figure
                label={t("account.remaining")}
                value={fmtDays(v.remaining)}
                strong
                className="col-span-2 sm:col-span-3"
              />
            </dl>
          </Section>

          <div className="flex flex-col gap-6">
            <Section title={t("compliance.ueberzeit_year", { year: data.year })}>
              <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-2xl font-semibold tabular">{fmtMinutes(ot.overtimeMin)}</span>
                  <span className="text-sm text-muted-foreground tabular">
                    {t("account.of_limit", { limit: fmtMinutes(ot.limitMin) })}
                  </span>
                </div>
                <Progress
                  value={Math.min(100, otPct * 100)}
                  className={cn(
                    "h-2",
                    ot.overtimeMin >= ot.limitMin
                      ? "[&>*]:bg-destructive"
                      : ot.overtimeMin >= ot.warnAtMin
                        ? "[&>*]:bg-warning"
                        : undefined,
                  )}
                  aria-label={t("compliance.ueberzeit_year", { year: data.year })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("account.ueberzeit_hint", { max: ot.weeklyMaxHours })}
                </p>
              </div>
            </Section>

            <Section title={t("account.adjustment_list")}>
              {adjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("account.no_adjustments")}</p>
              ) : (
                <ul className="flex flex-col rounded-xl border bg-card px-5">
                  {adjustments.map((a) => (
                    <li key={`${a.account}${a.id}`} className="flex items-start gap-3 border-b py-3 last:border-b-0">
                      <StatusBadge>{t(`account.kind.${a.kind}`)}</StatusBadge>
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          <span className="font-medium">
                            {a.account === "time" ? (
                              <Duration minutes={a.amount} balance />
                            ) : (
                              `${a.amount > 0 ? "+" : ""}${fmtDays(a.amount)} ${t("common.days")}`
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {fmtDay(a.effectiveDate, intl, { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-pretty">
                          {a.reason}
                          {a.createdBy ? ` · ${a.createdBy}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </PeriodContent>
    </div>
  )
}

function Figure({
  label,
  value,
  strong,
  className,
}: {
  label: string
  value: string
  strong?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg bg-card px-4 py-3 ring-1 ring-border",
        strong && "bg-brand-soft ring-0",
        className,
      )}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular", strong ? "text-2xl font-semibold" : "text-lg font-medium")}>{value}</dd>
    </div>
  )
}

export function AccountSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}
