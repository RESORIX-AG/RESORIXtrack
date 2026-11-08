/**
 * PDF reports (@react-pdf/renderer, server only). Layout follows v1's printed reports: accent bar, logo or
 * company name, title with period, key figure cards, a dense table, page numbers; the timesheet ends with
 * signature lines. Standard Helvetica (WinAnsi): keep text to Latin-1 plus en dash and middle dot.
 */
// this whole module is loaded on demand by renderReport (render/index.tsx), never at start-up
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import type { ReactNode } from "react"
import type { ComplianceReportData } from "@/features/reports/compliance-report"
import type { AbsencesReportData, BalancesData, ProjectHoursData, TimesheetData } from "@/server/services/reports"
import { localDateOf } from "@/server/time"
import { type ExportI18n, hm } from "./labels"
import { findingAmount, findingWhen, projectName } from "./tables"

// no automatic hyphenation: it splits durations like "(5:53)" across lines
Font.registerHyphenationCallback((word) => [word])

const INK = "#1c1c1f"
const MUTED = "#62656b"
const FAINT = "#8a8d93"
const NAVY = "#14254d"
const LINE = "#e4e8ee"
const POS = "#2e8b57"
const NEG = "#b8741a"

const s = StyleSheet.create({
  dateCell: { flexDirection: "row" },
  logRow: { flexDirection: "row", alignItems: "flex-start" },
  logText: { flex: 1, paddingRight: 6 },
  logMin: { width: 26, textAlign: "right" },
  weekday: { width: 18 },
  page: {
    paddingTop: 34,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 8.5,
    color: INK,
  },
  bar: { height: 3, borderRadius: 1.5, marginBottom: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 },
  logo: { height: 26, objectFit: "contain" },
  company: { fontWeight: 700, fontSize: 13, color: NAVY },
  meta: { textAlign: "right", color: MUTED, fontSize: 7.5, lineHeight: 1.5 },
  h1: { fontWeight: 700, fontSize: 16, color: NAVY, marginBottom: 2 },
  h2: { fontWeight: 700, fontSize: 10.5, color: NAVY, marginTop: 16, marginBottom: 6 },
  sub: { color: MUTED, marginBottom: 14 },
  cards: { flexDirection: "row", gap: 8, marginBottom: 14 },
  card: { flex: 1, borderWidth: 0.6, borderColor: LINE, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 9 },
  cardK: { color: MUTED, fontSize: 6.5, textTransform: "uppercase", letterSpacing: 0.4 },
  cardV: { fontWeight: 700, fontSize: 13, color: NAVY, marginTop: 3 },
  thead: { flexDirection: "row", backgroundColor: NAVY, color: "#ffffff", fontWeight: 700, fontSize: 7.5 },
  th: { paddingVertical: 5, paddingHorizontal: 5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE },
  td: { paddingVertical: 4, paddingHorizontal: 5 },
  weekend: { backgroundColor: "#f6f8fa", color: FAINT },
  holiday: { backgroundColor: "#fdf1f0" },
  total: { fontWeight: 700, borderTopWidth: 1, borderTopColor: NAVY, borderBottomWidth: 0 },
  group: { fontWeight: 700, backgroundColor: "#f6f8fa" },
  num: { textAlign: "right" },
  tag: {
    color: "#ffffff",
    fontSize: 6.5,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 6,
    marginRight: 3,
    marginBottom: 1,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  small: { fontSize: 7, color: MUTED },
  foot: { marginTop: 8, color: FAINT, fontSize: 7 },
  sign: { flexDirection: "row", gap: 36, marginTop: 44 },
  signLine: { flex: 1, borderTopWidth: 0.6, borderTopColor: FAINT, paddingTop: 4, color: MUTED, fontSize: 7.5 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    color: FAINT,
    fontSize: 7,
  },
})

export interface PdfContext {
  x: ExportI18n
  company: string
  accent: string
  /** PNG logo for light backgrounds, if the company uploaded one */
  logo: Buffer | null
  generated: string
}

interface Col {
  label: string
  flex: number
  num?: boolean
}
type RowKind = "weekend" | "holiday" | "total" | "group" | undefined

function Table({ cols, rows }: { cols: Col[]; rows: { key: string; kind?: RowKind; cells: ReactNode[] }[] }) {
  return (
    <View>
      <View style={s.thead} fixed>
        {cols.map((c) => (
          <Text key={c.label} style={[s.th, { flex: c.flex }, c.num ? s.num : {}]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.key} style={[s.tr, r.kind ? s[r.kind] : {}]} wrap={false}>
          {r.cells.map((cell, i) => (
            <View key={cols[i].label} style={[s.td, { flex: cols[i].flex }]}>
              {typeof cell === "string" || typeof cell === "number" ? (
                <Text style={cols[i].num ? s.num : {}}>{cell}</Text>
              ) : (
                cell
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

function Signed({ min, bold }: { min: number | null | undefined; bold?: boolean }) {
  if (min == null) return null
  const color = min > 0.5 ? POS : min < -0.5 ? NEG : INK
  return <Text style={[s.num, { color }, bold ? { fontWeight: 700 } : {}]}>{hm(min, true)}</Text>
}

function Cards({ items }: { items: [string, string, string?][] }) {
  return (
    <View style={s.cards}>
      {items.map(([k, v, hint]) => (
        <View key={k} style={s.card}>
          <Text style={s.cardK}>{k}</Text>
          <Text style={s.cardV}>{v}</Text>
          {hint ? <Text style={s.small}>{hint}</Text> : null}
        </View>
      ))}
    </View>
  )
}

function Shell({
  ctx,
  title,
  meta,
  landscape,
  children,
}: {
  ctx: PdfContext
  title: string
  meta: string[]
  landscape?: boolean
  children: ReactNode
}) {
  const { L } = ctx.x
  return (
    <Document title={title} author={ctx.company} creator="RESORIXtrack" producer="RESORIXtrack" language={ctx.x.locale}>
      <Page size="A4" orientation={landscape ? "landscape" : "portrait"} style={s.page}>
        <View style={[s.bar, { backgroundColor: ctx.accent }]} />
        <View style={s.header}>
          {ctx.logo ? <Image src={ctx.logo} style={s.logo} /> : <Text style={s.company}>{ctx.company}</Text>}
          <View>
            {meta.map((m) => (
              <Text key={m} style={s.meta}>
                {m}
              </Text>
            ))}
            <Text style={s.meta}>{L("generated", { date: ctx.generated })}</Text>
          </View>
        </View>
        {children}
        <View style={s.footer} fixed>
          <Text>RESORIXtrack · {ctx.company}</Text>
          <Text render={({ pageNumber, totalPages }) => L("page", { page: pageNumber, pages: totalPages })} />
        </View>
      </Page>
    </Document>
  )
}

// ------------------------------------------------------------------ timesheet

export function TimesheetPdf({ d, ctx }: { d: TimesheetData; ctx: PdfContext }) {
  const { x } = ctx
  const { L } = x
  const month = x.month(d.year, d.month)
  const sm = d.summary
  const cols: Col[] = [
    { label: L("date"), flex: 1.1 },
    { label: L("times"), flex: 2.6 },
    { label: L("info"), flex: 3.2 },
    { label: L("break"), flex: 0.8, num: true },
    { label: L("worked"), flex: 0.9, num: true },
    { label: L("target"), flex: 0.9, num: true },
    { label: L("delta"), flex: 0.9, num: true },
  ]
  const rows: { key: string; kind?: RowKind; cells: ReactNode[] }[] = d.days.map((day) => {
    const kind: RowKind = day.holiday ? "holiday" : !day.isWorkday && !day.workedMin ? "weekend" : undefined
    const times = (d.entries[day.date] ?? [])
      .filter((e) => e.kind === "work")
      .map((e) => `${e.start}-${e.end ?? "…"}${e.edited ? " *" : ""}`)
      .join(", ")
    const info = (
      <View key="info">
        <View style={s.tags}>
          {day.holiday ? (
            <Text style={{ marginRight: 3 }}>
              {x.holidayName(day.holiday.name)}
              {day.holiday.fraction < 1 ? " (½)" : ""}
            </Text>
          ) : null}
          {day.absences
            .filter((a) => a.status === "approved")
            .map((a) => (
              <Text key={a.id} style={[s.tag, { backgroundColor: a.color }]}>
                {x.absenceLabel({ key: a.typeKey, label: a.label })}
                {a.halves.length === 1 ? " ½" : ""}
              </Text>
            ))}
          {day.warnings.includes("break_too_short") ? <Text style={s.small}>{L("break_warning")}</Text> : null}
        </View>
        {(d.projectTime[day.date] ?? []).map((w, i) => (
          // rendered once to a PDF, never reconciled; project lines carry no id here
          // oxlint-disable-next-line react/no-array-index-key
          <View key={`${day.date}-${i}`} style={s.logRow}>
            <Text style={[s.small, s.logText]}>
              {w.project ? `${w.project}${w.note ? ": " : ""}` : ""}
              {w.note}
            </Text>
            <Text style={[s.small, s.logMin]}>{hm(w.minutes)}</Text>
          </View>
        ))}
      </View>
    )
    return {
      key: day.date,
      kind,
      cells: [
        // weekday and date in fixed columns, so "Mo"/"Di"/"Mi" never shift the date (Helvetica digits are equal width)
        <View key="date" style={s.dateCell}>
          <Text style={s.weekday}>{x.weekday(day.date)}</Text>
          <Text>{`${day.date.slice(8, 10)}.${day.date.slice(5, 7)}.`}</Text>
        </View>,
        times,
        info,
        day.breakMin ? hm(day.breakMin) : "",
        day.workedMin ? hm(day.workedMin) : "",
        day.targetMin ? hm(day.targetMin) : "",
        day.isToday && (day.workedMin || day.targetMin) ? (
          <Text key="delta" style={s.small}>
            {L("in_progress")}
          </Text>
        ) : day.deltaMin && !day.isFuture ? (
          <Signed key="delta" min={day.deltaMin} />
        ) : (
          ""
        ),
      ],
    }
  })
  rows.push({
    key: "total",
    kind: "total",
    cells: [
      L("total"),
      "",
      "",
      "",
      hm(sm.workedCompleteMin),
      hm(sm.targetMin),
      <Signed key="t" min={sm.deltaMin} bold />,
    ],
  })
  const v = d.vacation
  return (
    <Shell
      ctx={ctx}
      title={`${L("timesheet")} ${d.user.name} ${month}`}
      meta={[d.user.team ? `${d.user.name} · ${d.user.team}` : d.user.name, d.user.email]}
    >
      <Text style={s.h1}>
        {L("timesheet")} {month}
      </Text>
      <Text style={s.sub}>
        {d.user.name} · {L("timezone")} {d.user.timezone}
      </Text>
      <Cards
        items={[
          [
            L("worked"),
            hm(sm.workedCompleteMin),
            sm.todayWorkedMin > 0 ? L("plus_today", { time: hm(sm.todayWorkedMin) }) : undefined,
          ],
          [L("target"), hm(sm.targetMin)],
          [L("delta"), hm(sm.deltaMin, true)],
          [L("balance"), hm(d.balanceAfterMin, true)],
          [L("vacation_left"), `${x.days(v.remaining)} ${L("days_unit")}`],
        ]}
      />
      <Table cols={cols} rows={rows} />
      <View style={{ marginTop: 12, width: "80%" }} wrap={false}>
        <View style={s.tr}>
          <Text style={[s.td, { flex: 1.4 }]}>{L("balance_before")}</Text>
          <View style={[s.td, { flex: 1 }]}>
            <Signed min={d.balanceBeforeMin} />
          </View>
        </View>
        <View style={s.tr}>
          <Text style={[s.td, { flex: 1.4 }]}>{L("balance_after")}</Text>
          <View style={[s.td, { flex: 1 }]}>
            <Signed min={d.balanceAfterMin} bold />
          </View>
        </View>
        {sm.sundayWorkMin + sm.holidayWorkMin + sm.nightWorkMin > 0 ? (
          <View style={s.tr}>
            <Text style={[s.td, { flex: 1.4 }]}>{L("payroll")}</Text>
            <Text style={[s.td, s.num, { flex: 1.6 }]}>{payrollLine(sm, d.payroll, x)}</Text>
          </View>
        ) : null}
        <View style={s.tr}>
          <Text style={[s.td, { flex: 1.4 }]}>
            {L("vacation")} ({L("entitlement")} {x.days(v.entitlement)} + {L("carried")} {x.days(v.carriedOver)})
          </Text>
          <Text style={[s.td, s.num, { flex: 1.6 }]}>
            {L("taken")} {x.days(v.taken)} · {L("planned")} {x.days(v.planned)} · {L("left")} {x.days(v.remaining)}
          </Text>
        </View>
      </View>
      <Text style={s.foot}>* {L("edited_note")}</Text>
      {d.signoff ? (
        <Text style={[s.foot, { color: POS }]}>
          {L("signed_off", {
            name: d.signoff.signedBy ?? "?",
            date: x.date(localDateOf(d.signoff.signedAt, d.user.timezone)),
            seal: d.signoff.seal,
          })}
        </Text>
      ) : null}
      <View style={s.sign} wrap={false}>
        <Text style={s.signLine}>{L("sign_employee")}</Text>
        <Text style={s.signLine}>{L("sign_lead")}</Text>
      </View>
    </Shell>
  )
}

/** "Sunday 2:00 · Holiday 1:00 (50 %) · Night 0:30 · Time credit 0:03" for payroll. */
function payrollLine(sm: TimesheetData["summary"], payroll: TimesheetData["payroll"], x: PdfContext["x"]): string {
  const { L } = x
  const pct = payroll.mode === "payroll" && sm.sundayWorkMin + sm.holidayWorkMin > 0 ? ` (${payroll.percent} %)` : ""
  const credit = sm.surchargeMin + sm.nightCreditMin
  return [
    `${L("sunday_work")} ${hm(sm.sundayWorkMin)}`,
    `${L("holiday_work")} ${hm(sm.holidayWorkMin)}${pct}`,
    `${L("night_work")} ${hm(sm.nightWorkMin)}`,
    ...(credit > 0 ? [`${L("time_credit")} ${hm(credit)}`] : []),
  ].join(" · ")
}

// ------------------------------------------------------------------ balances

export function BalancesPdf({ d, ctx }: { d: BalancesData; ctx: PdfContext }) {
  const { x } = ctx
  const { L } = x
  const period = d.month ? x.month(d.year, d.month) : String(d.year)
  const cols: Col[] = [
    { label: L("name"), flex: 2.2 },
    { label: L("team"), flex: 1.8 },
    { label: L("target"), flex: 1, num: true },
    { label: L("worked"), flex: 1, num: true },
    { label: L("delta"), flex: 1, num: true },
    { label: L("balance"), flex: 1, num: true },
    { label: L("sunday_work"), flex: 0.8, num: true },
    { label: L("holiday_work"), flex: 0.8, num: true },
    { label: L("night_work"), flex: 0.8, num: true },
    { label: L("taken"), flex: 0.8, num: true },
    { label: L("planned"), flex: 0.8, num: true },
    { label: L("pending"), flex: 0.8, num: true },
    { label: L("vacation_left"), flex: 1, num: true },
  ]
  const rows: { key: string; kind?: RowKind; cells: ReactNode[] }[] = d.rows.map((r) => ({
    key: String(r.userId),
    cells: [
      r.name,
      r.team ?? "",
      hm(r.targetMin),
      hm(r.workedMin),
      <Signed key="d" min={r.deltaMin} />,
      <Signed key="b" min={r.balanceMin} bold />,
      r.sundayMin ? hm(r.sundayMin) : "",
      r.holidayMin ? hm(r.holidayMin) : "",
      r.nightMin ? hm(r.nightMin) : "",
      x.days(r.vacationTaken),
      x.days(r.vacationPlanned),
      x.days(r.vacationPending),
      x.days(r.vacationRemaining),
    ],
  }))
  const t = d.totals
  rows.push({
    key: "total",
    kind: "total",
    cells: [
      L("total"),
      "",
      hm(t.targetMin),
      hm(t.workedMin),
      <Signed key="d" min={t.deltaMin} />,
      <Signed key="b" min={t.balanceMin} bold />,
      t.sundayMin ? hm(t.sundayMin) : "",
      t.holidayMin ? hm(t.holidayMin) : "",
      t.nightMin ? hm(t.nightMin) : "",
      "",
      "",
      "",
      "",
    ],
  })
  return (
    <Shell ctx={ctx} title={`${L("balances")} ${period}`} meta={[period]} landscape>
      <Text style={s.h1}>
        {L("balances")} {period}
      </Text>
      <Text style={s.sub}>
        {L("people", { count: d.rows.length })}
        {d.payroll.mode === "payroll" && t.sundayMin + t.holidayMin > 0
          ? ` · ${L("supplement_note", { percent: d.payroll.percent })}`
          : ""}
      </Text>
      <Table cols={cols} rows={rows} />
    </Shell>
  )
}

// ------------------------------------------------------------------ absences

export function AbsencesPdf({ d, ctx }: { d: AbsencesReportData; ctx: PdfContext }) {
  const { x } = ctx
  const { L } = x
  const period = `${x.date(d.start)} – ${x.date(d.end)}`
  const label = (key: string, fallback: string) => x.absenceLabel({ key, label: fallback })
  const sumCols: Col[] = [
    { label: L("name"), flex: 2.4 },
    ...d.types.map((t) => ({ label: label(t.key, t.label), flex: 1, num: true })),
    { label: L("total"), flex: 1, num: true },
  ]
  const half = (h: string) => (h === "full" ? "" : ` (${L(`half_${h}`)})`)
  return (
    <Shell ctx={ctx} title={`${L("absences")} ${period}`} meta={[period]} landscape>
      <Text style={s.h1}>{L("absences")}</Text>
      <Text style={s.sub}>{period}</Text>
      <Text style={s.h2}>{L("summary")}</Text>
      <Table
        cols={sumCols}
        rows={d.summary
          .filter((r) => r.total > 0)
          .map((r) => ({
            key: String(r.userId),
            cells: [
              r.name,
              ...d.types.map((t) => (r.byType[t.key] ? x.days(r.byType[t.key]) : "")),
              <Text key="t" style={[s.num, { fontWeight: 700 }]}>
                {x.days(r.total)}
              </Text>,
            ],
          }))}
      />
      <Text style={s.h2}>{L("details")}</Text>
      <Table
        cols={[
          { label: L("name"), flex: 2 },
          { label: L("type"), flex: 1.6 },
          { label: L("status"), flex: 1.1 },
          { label: L("from"), flex: 1.4 },
          { label: L("to"), flex: 1.4 },
          { label: L("days"), flex: 0.7, num: true },
          { label: L("note"), flex: 2.4 },
        ]}
        rows={d.rows.map((r) => ({
          key: String(r.id),
          cells: [
            r.name,
            <View key="t" style={s.tags}>
              <Text style={[s.tag, { backgroundColor: r.color }]}>{label(r.typeKey, r.type)}</Text>
            </View>,
            x.status(r.status),
            `${x.date(r.startDate)}${half(r.startHalf)}`,
            `${x.date(r.endDate)}${half(r.endHalf)}`,
            x.days(r.days),
            r.note,
          ],
        }))}
      />
    </Shell>
  )
}

// ------------------------------------------------------------------ projects

export function ProjectsPdf({ d, ctx }: { d: ProjectHoursData; ctx: PdfContext }) {
  const { x } = ctx
  const { L } = x
  const period = `${x.date(d.start)} – ${x.date(d.end)}`
  const rows: { key: string; kind?: RowKind; cells: ReactNode[] }[] = []
  for (const p of d.projects) {
    const key = `p${p.projectId ?? ""}`
    rows.push({
      key,
      kind: "group",
      cells: [
        <View key="n" style={s.tags}>
          {p.color ? (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.color, marginRight: 4 }} />
          ) : null}
          <Text>
            {projectName(p, x)}
            {p.code ? ` (${p.code})` : ""}
          </Text>
        </View>,
        p.team ?? "",
        L("items_n", { count: p.items }),
        hm(p.minutes),
      ],
    })
    for (const person of p.people)
      rows.push({ key: `${key}u${person.userId}`, cells: ["", "", person.name, hm(person.minutes)] })
  }
  return (
    <Shell ctx={ctx} title={`${L("projects")} ${period}`} meta={[period]}>
      <Text style={s.h1}>{L("projects")}</Text>
      <Text style={s.sub}>{period}</Text>
      <Cards
        items={[
          [L("total"), hm(d.totalMin)],
          [L("projects_count"), String(d.projects.length)],
          [L("people_count"), String(d.people.filter((p) => p.minutes > 0).length)],
        ]}
      />
      <Table
        cols={[
          { label: L("project"), flex: 3 },
          { label: L("team"), flex: 1.6 },
          { label: L("person"), flex: 2 },
          { label: L("worked"), flex: 1, num: true },
        ]}
        rows={rows}
      />
    </Shell>
  )
}

// ------------------------------------------------------------------ compliance

export function CompliancePdf({ d, ctx }: { d: ComplianceReportData; ctx: PdfContext }) {
  const { x } = ctx
  const { L, t } = x
  const period = `${x.date(d.start)} – ${x.date(d.end)}`
  const findings = d.rows.flatMap((r) => r.findings.map((f, i) => ({ r, f, key: `${r.userId}-${i}` })))
  return (
    <Shell ctx={ctx} title={`${L("compliance")} ${period}`} meta={[period]} landscape>
      <Text style={s.h1}>{L("compliance")}</Text>
      <Text style={s.sub}>{period}</Text>
      <Table
        cols={[
          { label: L("name"), flex: 2.2 },
          { label: L("team"), flex: 1.6 },
          { label: t("compliance.severity.violation"), flex: 1, num: true },
          { label: t("compliance.severity.warning"), flex: 1, num: true },
          { label: t("compliance.severity.info"), flex: 1, num: true },
          { label: L("ueberzeit", { year: d.year }), flex: 1.6, num: true },
        ]}
        rows={d.rows.map((r) => ({
          key: String(r.userId),
          cells: [
            r.name,
            r.team ?? "",
            r.counts.violation ? (
              <Text key="v" style={[s.num, { color: NEG, fontWeight: 700 }]}>
                {r.counts.violation}
              </Text>
            ) : (
              ""
            ),
            r.counts.warning ? String(r.counts.warning) : "",
            r.counts.info ? String(r.counts.info) : "",
            `${hm(r.overtime.overtimeMin)} / ${hm(r.overtime.limitMin)}`,
          ],
        }))}
      />
      {findings.length ? (
        <>
          <Text style={s.h2}>{L("details")}</Text>
          <Table
            cols={[
              { label: L("name"), flex: 2 },
              { label: L("when"), flex: 1.2 },
              { label: L("rule"), flex: 2.4 },
              { label: L("severity"), flex: 1.1 },
              { label: L("value"), flex: 0.9, num: true },
              { label: L("limit"), flex: 0.9, num: true },
              { label: L("ref"), flex: 1.6 },
            ]}
            rows={findings.map(({ r, f, key }) => ({
              key,
              cells: [
                r.name,
                /^\d{4}-\d{2}-\d{2}$/.test(findingWhen(f)) ? x.date(findingWhen(f)) : findingWhen(f),
                t(`compliance.rule.${f.rule}`),
                <Text key="s" style={f.severity === "violation" ? { color: NEG, fontWeight: 700 } : {}}>
                  {t(`compliance.severity.${f.severity}`)}
                </Text>,
                findingAmount(f, f.value),
                findingAmount(f, f.limit),
                f.ref,
              ],
            }))}
          />
        </>
      ) : (
        <Text style={s.foot}>{L("no_findings")}</Text>
      )}
    </Shell>
  )
}
