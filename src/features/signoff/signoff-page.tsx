/**
 * Month sign-off for leads and HR: figures and readiness per person, sign off many at once (each person on
 * their own), the month's sign-offs with seal status, reopen (HR, with a logged reason) and the integrity
 * check of all seals and database guards.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Lock, ShieldCheck } from "lucide-react"
import { startTransition, useId, useOptimistic, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/app/confirm"
import { Page, PageHeader, Section } from "@/components/app/page"
import { PeriodContent } from "@/components/app/period-nav"
import { ReasonDialog } from "@/components/app/reason-dialog"
import { StatusBadge } from "@/components/app/status-badge"
import { PersonAvatar } from "@/components/app/user-menu"
import { DataTable } from "@/components/data/data-table"
import { Duration } from "@/components/data/duration"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MonthNav, TeamFilter } from "@/features/reports/controls"
import { teamScopeQuery } from "@/features/team/api"
import { todayIn } from "@/features/time/lib"
import { attempt } from "@/lib/attempt"
import { addMonthsStr, dayOf, fmtDateTime, fmtDay, fmtMinutes, fmtMonth } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { SignoffDto } from "@/server/services/signoffs"
import { reopenFn, signOffFn, signoffOverviewQuery, signoffsQuery, verifySignoffsFn } from "./api"

type Overview = Awaited<ReturnType<NonNullable<ReturnType<typeof signoffOverviewQuery>["queryFn"]>>>
type Row = Overview["rows"][number]
type Integrity = NonNullable<SignoffDto["integrity"]>
type Verify = Awaited<ReturnType<typeof verifySignoffsFn>>
const col = tableHelper<Row>()
const histCol = tableHelper<SignoffDto>()

export interface SignoffSearch {
  month?: string
  team?: number
}

const ready = (r: Row) => r.canSign && !r.signoff && r.blockers.length === 0
const NOBODY: ReadonlySet<number> = new Set()

function useRefresh() {
  const qc = useQueryClient()
  return () =>
    Promise.all(
      [["signoff"], ["team"], ["time"], ["account"], ["reports"]].map((queryKey) => qc.invalidateQueries({ queryKey })),
    )
}

function Status({ r, signing }: { r: Row; signing: boolean }) {
  const { t, intl } = useI18n()
  const me = useMe()
  if (signing) {
    return (
      <StatusBadge tone="positive" icon="signed" className="opacity-70">
        {t("signoff.signed")}
      </StatusBadge>
    )
  }
  if (r.signoff) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone="positive" icon="signed">
          {t("signoff.signed")}
        </StatusBadge>
        <span
          className="text-xs text-muted-foreground"
          title={fmtDateTime(r.signoff.signedAt, { intl, tz: me.timezone, hour12: me.timeFormat === "12h" })}
        >
          {r.signoff.signedBy?.name} · {fmtDay(dayOf(r.signoff.signedAt, me.timezone), intl)}
        </span>
      </span>
    )
  }
  if (r.blockers.length) {
    return (
      <span className="flex flex-wrap gap-1">
        {r.blockers.map((b) => (
          <Tooltip key={b}>
            <TooltipTrigger render={<span />}>
              <StatusBadge tone="warning" icon="warning">
                {t(`signoff.blocker.${b}`)}
              </StatusBadge>
            </TooltipTrigger>
            <TooltipContent>{t(`signoff.blocker_help.${b}`)}</TooltipContent>
          </Tooltip>
        ))}
      </span>
    )
  }
  if (!r.canSign)
    return <StatusBadge>{r.user.id === me.id ? t("signoff.own_month") : t("signoff.not_allowed")}</StatusBadge>
  return (
    <StatusBadge tone="brand" icon="approved">
      {t("signoff.open")}
    </StatusBadge>
  )
}

export function SignoffPage({
  search,
  onSearch,
}: {
  search: SignoffSearch
  onSearch: (s: Partial<SignoffSearch>) => void
}) {
  const signoffNoteId = useId()
  const { t, intl, tError } = useI18n()
  const me = useMe()
  const today = todayIn(me.timezone)
  const refresh = useRefresh()
  const { data: scope } = useSuspenseQuery(teamScopeQuery)
  const params = { month: search.month ?? null, teamId: search.team ?? null }
  const q = useQuery({ ...signoffOverviewQuery(params), placeholderData: keepPreviousData })
  const ov = q.data
  if (!ov) throw new Error("sign-off overview not loaded")
  const month = ov.month
  const monthLabel = fmtMonth(month, intl)
  const history = useQuery({ ...signoffsQuery({ month }), placeholderData: keepPreviousData })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState("")
  const [reopen, setReopen] = useState<SignoffDto | null>(null)
  const [integrity, setIntegrity] = useState<Verify | null>(null)
  // rows being signed show as signed at once; when the Action settles the refetched overview takes over
  const [signing, markSigning] = useOptimistic(
    NOBODY,
    (ids: ReadonlySet<number>, add: number[]) => new Set([...ids, ...add]),
  )
  const signable = ov.rows.filter((r) => ready(r) && !signing.has(r.user.id))
  const chosen = signable.filter((r) => selected.has(r.user.id))
  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const allSigned = ov.rows.length > 0 && ov.rows.every((r) => r.signoff || signing.has(r.user.id))
  const columns = [
    // kept in a fully signed month too, so the columns line up when switching months
    col.display({
      id: "select",
      header: () =>
        signable.length ? (
          <Checkbox
            checked={chosen.length === signable.length}
            indeterminate={chosen.length > 0 && chosen.length < signable.length}
            onCheckedChange={(v) => setSelected(v ? new Set(signable.map((r) => r.user.id)) : new Set())}
            aria-label={t("signoff.select_all")}
          />
        ) : null,
      meta: { hideOnMobile: true, width: "2.75rem" },
      cell: (c) =>
        ready(c.row.original) && !signing.has(c.row.original.user.id) ? (
          <Checkbox
            checked={selected.has(c.row.original.user.id)}
            onCheckedChange={(v) => toggle(c.row.original.user.id, v)}
            aria-label={t("signoff.select_person", { name: c.row.original.user.name })}
          />
        ) : null,
    }),
    col.accessor((r) => r.user.name, {
      id: "name",
      header: () => t("common.name"),
      meta: { primary: true, width: "13rem" },
      cell: (c) => {
        const r = c.row.original
        return (
          <span className="flex min-w-0 items-center gap-3">
            {ready(r) && !signing.has(r.user.id) ? (
              <Checkbox
                className="md:hidden"
                checked={selected.has(r.user.id)}
                onCheckedChange={(v) => toggle(r.user.id, v)}
                aria-label={t("signoff.select_person", { name: r.user.name })}
              />
            ) : null}
            <PersonAvatar name={r.user.name} className="size-8" />
            <span className="min-w-0">
              <Link
                to="/team/member/$userId"
                params={{ userId: r.user.id }}
                search={{ month }}
                className="block truncate font-medium hover:underline"
              >
                {r.user.name}
              </Link>
              {r.user.teamName ? (
                <span className="block truncate text-xs text-muted-foreground">{r.user.teamName}</span>
              ) : null}
            </span>
          </span>
        )
      },
    }),
    col.accessor((r) => r.summary.targetMin, {
      id: "target",
      header: () => t("reports.target"),
      meta: { numeric: true, mobileLabel: t("reports.target"), width: "6.5rem" },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    col.accessor((r) => r.summary.workedCompleteMin, {
      id: "worked",
      header: () => t("reports.worked"),
      meta: { numeric: true, mobileLabel: t("reports.worked"), width: "6.5rem" },
      cell: (c) => fmtMinutes(c.getValue()),
    }),
    col.accessor((r) => r.summary.deltaMin, {
      id: "delta",
      header: () => t("reports.delta"),
      meta: { numeric: true, mobileLabel: t("reports.delta"), width: "6.5rem" },
      cell: (c) => <Duration minutes={c.getValue()} balance />,
    }),
    col.display({
      id: "status",
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status"), width: "14rem" },
      cell: (c) => <Status r={c.row.original} signing={signing.has(c.row.original.user.id)} />,
    }),
    me.isHr &&
      col.display({
        id: "actions",
        header: () => <span className="sr-only">{t("signoff.reopen")}</span>,
        meta: { className: "text-right", width: "8rem" },
        cell: (c) =>
          c.row.original.signoff ? (
            <Button intent="negative" variant="ghost" size="sm" onClick={() => setReopen(c.row.original.signoff)}>
              {t("signoff.reopen")}
            </Button>
          ) : null,
      }),
  ].filter((c) => c !== false)

  const onSign = () => {
    if (!chosen.length) {
      toast.info(signable.length ? t("signoff.select_first") : t("signoff.none_ready"))
      return
    }
    setConfirm(true)
  }
  const sign = () => {
    const ids = chosen.map((r) => r.user.id)
    const names = new Map(ov.rows.map((r) => [r.user.id, r.user.name]))
    const report = (results: Awaited<ReturnType<typeof signOffFn>>["results"]) => {
      const ok = results.filter((r) => r.ok).length
      if (ok) toast.success(t("signoff.signed_ok", { count: ok, month: monthLabel }))
      for (const f of results.filter((r) => !r.ok)) toast.error(`${names.get(f.userId) ?? ""}: ${tError(f.error)}`)
    }
    startTransition(async () => {
      markSigning(ids)
      const outcome = await attempt(signOffFn({ data: { month, userIds: ids, note } }))
      if (outcome.ok) {
        report(outcome.value.results)
        startTransition(() => {
          setSelected(new Set())
          setNote("")
        })
      } else toast.error(tError(outcome.error))
      await refresh()
    })
  }

  return (
    <Page>
      <PageHeader
        title={t("signoff.title")}
        actions={
          <>
            <TeamFilter scope={scope} value={search.team} onChange={(team) => onSearch({ team })} />
            <MonthNav
              month={month}
              today={addMonthsStr(today.slice(0, 7), -1)}
              onChange={(m) => onSearch({ month: m })}
            />
          </>
        }
      />
      <Section
        title={t("signoff.people", { month: monthLabel })}
        actions={
          allSigned ? null : (
            <Button onClick={onSign}>
              <Lock data-icon="inline-start" />
              {chosen.length ? t("signoff.sign_selected", { count: chosen.length }) : t("signoff.sign")}
            </Button>
          )
        }
      >
        <PeriodContent className={q.isPlaceholderData ? "opacity-60" : undefined}>
          <DataTable
            data={ov.rows}
            columns={columns}
            getRowId={(r) => String(r.user.id)}
            search={ov.rows.length > 12}
            empty={t("signoff.nobody")}
            rowClassName={(r) => (selected.has(r.user.id) && !signing.has(r.user.id) ? "bg-brand-soft" : undefined)}
          />
        </PeriodContent>
      </Section>

      <History items={history.data ?? []} integrity={integrity} />

      {me.isHr || me.isAdmin ? <IntegrityCheck result={integrity} onResult={setIntegrity} /> : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        destructive={false}
        title={t("signoff.confirm_title", { count: chosen.length, month: monthLabel })}
        description={t("signoff.confirm_message")}
        confirmLabel={t("signoff.confirm_button")}
        // optimistic: the dialog closes at once, failures are toasted and the rows return
        onConfirm={sign}
      >
        <Field>
          <FieldLabel htmlFor={signoffNoteId}>{t("signoff.note_label")}</FieldLabel>
          <Textarea
            id={signoffNoteId}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
        </Field>
      </ConfirmDialog>
      {reopen ? <ReopenDialog so={reopen} onClose={() => setReopen(null)} onDone={refresh} /> : null}
    </Page>
  )
}

const TONE: Record<Integrity, "positive" | "warning" | "negative"> = {
  intact: "positive",
  figures_changed: "warning",
  data_changed: "negative",
  seal_invalid: "negative",
  chain_broken: "negative",
}

function History({ items, integrity }: { items: SignoffDto[]; integrity: Verify | null }) {
  const { t, intl } = useI18n()
  const me = useMe()
  const problems = new Map(integrity?.problems.map((p) => [p.id, p.integrity]) ?? [])
  const columns = [
    histCol.accessor((r) => r.userName ?? "", {
      id: "name",
      header: () => t("common.name"),
      meta: { primary: true },
    }),
    histCol.accessor("signedAt", {
      header: () => t("signoff.signed"),
      meta: { mobileLabel: t("signoff.signed") },
      cell: (c) => (
        <span className="whitespace-nowrap">
          {c.row.original.signedBy?.name}{" "}
          <span className="text-muted-foreground">
            · {fmtDateTime(c.getValue(), { intl, tz: me.timezone, hour12: me.timeFormat === "12h" })}
          </span>
        </span>
      ),
    }),
    histCol.accessor((r) => r.figures?.balanceEndMin ?? null, {
      id: "balance",
      header: () => t("signoff.balance_end"),
      meta: { numeric: true, mobileLabel: t("signoff.balance_end") },
      cell: (c) => <Duration minutes={c.getValue()} balance />,
    }),
    histCol.display({
      id: "state",
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) => {
        const r = c.row.original
        if (!r.active)
          return (
            <span className="flex flex-col gap-0.5">
              <StatusBadge>{t("signoff.reopened")}</StatusBadge>
              <span className="text-xs text-muted-foreground">
                {r.reopenedBy?.name}: {r.reopenReason}
              </span>
            </span>
          )
        const status: Integrity | null = integrity ? (problems.get(r.id) ?? "intact") : null
        return status ? (
          <StatusBadge tone={TONE[status]} icon={status === "intact" ? "signed" : "warning"}>
            {t(`signoff.status.${status}`)}
          </StatusBadge>
        ) : (
          <StatusBadge tone="positive" icon="signed">
            {t("signoff.sealed")}
          </StatusBadge>
        )
      },
    }),
    histCol.accessor("digest", {
      header: () => t("signoff.seal"),
      enableSorting: false,
      meta: { hideOnMobile: true, className: "font-mono text-xs text-muted-foreground" },
      cell: (c) => c.getValue().slice(0, 12),
    }),
  ]
  // the people table already shows active sign-offs; this list adds reopened ones and seal results
  if (!items.length || (!integrity && items.every((r) => r.active))) return null
  return (
    <Section title={t("signoff.history")}>
      <DataTable
        data={items}
        columns={columns}
        getRowId={(r) => String(r.id)}
        pageSize={25}
        rowClassName={(r) => (r.active ? undefined : "opacity-70")}
      />
    </Section>
  )
}

function ReopenDialog({
  so,
  onClose,
  onDone,
}: {
  so: SignoffDto
  onClose: () => void
  onDone: () => Promise<unknown>
}) {
  const { t, intl } = useI18n()
  return (
    <ReasonDialog
      title={t("signoff.reopen_title", { name: so.userName ?? "", month: fmtMonth(so.month, intl) })}
      description={t("signoff.reopen_help")}
      hint={t("member.reason_logged")}
      submitLabel={t("signoff.reopen")}
      onClose={onClose}
      onSubmit={async (reason) => {
        await reopenFn({ data: { id: so.id, reason } })
        toast.success(t("signoff.reopened_ok"))
        await onDone()
      }}
    />
  )
}

function IntegrityCheck({ result, onResult }: { result: Verify | null; onResult: (r: Verify) => void }) {
  const { t, intl, tError } = useI18n()
  const me = useMe()
  const verify = useMutation({
    mutationFn: () => verifySignoffsFn({ data: {} }),
    onSuccess: onResult,
    onError: (err) => toast.error(tError(err)),
  })
  const busy = verify.isPending
  const run = () => verify.mutate()
  const total = result ? Object.values(result.counts).reduce((a, b) => a + b, 0) : 0
  return (
    <Section
      title={t("signoff.integrity_title")}
      actions={
        <Button variant="outline" size="sm" onClick={run} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
          {t("signoff.integrity_run")}
        </Button>
      }
    >
      {result ? (
        <output className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-sm">
          <p className="flex items-center gap-2">
            <StatusBadge tone={result.ok ? "positive" : "negative"} icon={result.ok ? "signed" : "warning"}>
              {result.ok ? t("signoff.integrity_ok_short") : t("signoff.integrity_bad_short")}
            </StatusBadge>
            <span className="text-muted-foreground">
              {t("signoff.integrity_counts", {
                n: total,
                guards: result.guards.expected - result.guards.missing.length,
                expected: result.guards.expected,
              })}
            </span>
          </p>
          {result.guards.missing.length ? (
            <p className="text-destructive">{t("signoff.guards_missing", { n: result.guards.missing.length })}</p>
          ) : null}
          {result.problems.length ? (
            <ul className="flex flex-col gap-1.5">
              {result.problems.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={TONE[p.integrity ?? "data_changed"]} icon="warning">
                    {t(`signoff.status.${p.integrity}`)}
                  </StatusBadge>
                  <span className="font-medium">
                    {p.userName} · {fmtMonth(p.month, intl)}
                  </span>
                  <span className="text-muted-foreground">
                    {t("signoff.signed_by_on", {
                      name: p.signedBy?.name ?? "?",
                      date: fmtDateTime(p.signedAt, { intl, tz: me.timezone }),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </output>
      ) : null}
    </Section>
  )
}
