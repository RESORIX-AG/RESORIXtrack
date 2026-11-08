/**
 * Absence types: read helpers used by absences, calendars and reports, and the default set that setup and
 * the demo seed install. Labels are English fallbacks; the UI translates known keys (namespace `absence_types`).
 */
import { asc, eq } from "drizzle-orm"
import { db } from "../db"
import { type AbsenceCategory, type AbsenceType, absenceTypes } from "../db/schema"
import { Validation } from "../errors"
import { type Actor, hrSelfFallback } from "./permissions"

type DefaultType = Omit<typeof absenceTypes.$inferInsert, "id" | "sort" | "isActive">

export const DEFAULT_ABSENCE_TYPES: DefaultType[] = [
  {
    key: "vacation",
    label: "Vacation",
    color: "#35a1cc",
    category: "vacation",
    creditsTime: true,
    deductsVacation: true,
    requiresApproval: true,
    allowsAttachments: false,
    employeeCanRequest: true,
  },
  {
    key: "sick",
    label: "Sick leave",
    color: "#e0a23b",
    category: "sick",
    creditsTime: true,
    deductsVacation: false,
    requiresApproval: false,
    allowsAttachments: true,
    employeeCanRequest: true,
  },
  {
    key: "accident",
    label: "Accident",
    color: "#d9534f",
    category: "sick",
    creditsTime: true,
    deductsVacation: false,
    requiresApproval: false,
    allowsAttachments: true,
    employeeCanRequest: false,
  },
  {
    key: "military",
    label: "Military / civil service",
    color: "#7a8b5c",
    category: "other",
    creditsTime: true,
    deductsVacation: false,
    requiresApproval: true,
    allowsAttachments: true,
    employeeCanRequest: true,
  },
  {
    key: "training",
    label: "Training",
    color: "#8f7ad1",
    category: "other",
    creditsTime: true,
    deductsVacation: false,
    requiresApproval: true,
    allowsAttachments: false,
    employeeCanRequest: true,
  },
  {
    key: "parental",
    label: "Parental leave",
    color: "#b07ad1",
    category: "other",
    creditsTime: true,
    deductsVacation: false,
    requiresApproval: true,
    allowsAttachments: true,
    employeeCanRequest: true,
  },
  {
    key: "unpaid",
    label: "Unpaid leave",
    color: "#62656b",
    category: "other",
    creditsTime: true,
    deductsVacation: false,
    requiresApproval: true,
    allowsAttachments: false,
    employeeCanRequest: true,
  },
  // time off taken from the overtime balance (Mehrarbeit / Überzeit): no credit, so the day's target is drawn from the balance
  {
    key: "compensation",
    label: "Time off in lieu",
    color: "#61cae2",
    category: "other",
    creditsTime: false,
    deductsVacation: false,
    requiresApproval: true,
    allowsAttachments: false,
    employeeCanRequest: true,
  },
  {
    key: "other",
    label: "Other absence",
    color: "#8a8d93",
    category: "other",
    creditsTime: true,
    deductsVacation: false,
    requiresApproval: true,
    allowsAttachments: true,
    employeeCanRequest: true,
  },
]

/** Install missing default types (idempotent; existing keys, including v1 imports, are left alone). */
export function ensureDefaultAbsenceTypes(): number {
  const existing = new Set(
    db
      .select({ key: absenceTypes.key })
      .from(absenceTypes)
      .all()
      .map((r) => r.key),
  )
  let added = 0
  DEFAULT_ABSENCE_TYPES.forEach((t, i) => {
    if (existing.has(t.key)) return
    db.insert(absenceTypes)
      .values({ ...t, sort: i * 10 })
      .run()
    added++
  })
  return added
}

export function listAbsenceTypes(opts: { activeOnly?: boolean } = {}): AbsenceType[] {
  const q = db.select().from(absenceTypes)
  return (opts.activeOnly ? q.where(eq(absenceTypes.isActive, true)) : q)
    .orderBy(asc(absenceTypes.sort), asc(absenceTypes.id))
    .all()
}

export function absenceTypesById(): Map<number, AbsenceType> {
  return new Map(listAbsenceTypes().map((t) => [t.id, t]))
}

/** Active type by id or key; unknown or inactive types are a validation error on the `type` field. */
export function getAbsenceType(ref: number | string): AbsenceType {
  const byId = typeof ref === "number" || /^\d+$/.test(ref)
  const t = db
    .select()
    .from(absenceTypes)
    .where(byId ? eq(absenceTypes.id, Number(ref)) : eq(absenceTypes.key, ref))
    .get()
  if (!t?.isActive) throw new Validation("Unknown absence type", { fields: { type: "invalid" } })
  return t
}

/** Types the actor may record for themselves (every type only as HR when nobody else could record them). */
export function requestableTypes(actor: Actor): AbsenceType[] {
  const all = hrSelfFallback(actor, actor.user)
  return listAbsenceTypes({ activeOnly: true }).filter((t) => t.employeeCanRequest || all)
}

export function isSensitive(category: AbsenceCategory): boolean {
  return category === "sick"
}

export function serializeAbsenceType(t: AbsenceType) {
  return {
    id: t.id,
    key: t.key,
    label: t.label,
    color: t.color,
    category: t.category,
    creditsTime: t.creditsTime,
    deductsVacation: t.deductsVacation,
    requiresApproval: t.requiresApproval,
    allowsAttachments: t.allowsAttachments,
    employeeCanRequest: t.employeeCanRequest,
    isActive: t.isActive,
    sort: t.sort,
  }
}
export type AbsenceTypeDto = ReturnType<typeof serializeAbsenceType>
