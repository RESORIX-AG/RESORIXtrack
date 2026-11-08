/** Absence inputs (client-safe: used by server-function validators, which ship to the browser). */
import { z } from "zod"

export const dayString = z.iso.date()

/** Earlier / later of two `YYYY-MM-DD` days. */
export const minDay = (a: string, b: string) => (a <= b ? a : b)
export const maxDay = (a: string, b: string) => (a >= b ? a : b)
const half = z.enum(["full", "am", "pm"])
const typeRef = z.union([z.number().int().positive(), z.string().min(1).max(32)])

export const absenceInput = z.object({
  userId: z.number().int().positive().nullish(),
  type: typeRef,
  startDate: dayString,
  endDate: dayString.nullish(),
  startHalf: half.default("full"),
  endHalf: half.default("full"),
  note: z.string().max(1000).default(""),
})
export type AbsenceInput = z.input<typeof absenceInput>

export const absencePatch = z.object({
  startDate: dayString.optional(),
  endDate: dayString.optional(),
  startHalf: half.optional(),
  endHalf: half.optional(),
  note: z.string().max(1000).optional(),
  reason: z.string().max(1000).default(""),
})
export type AbsencePatch = z.input<typeof absencePatch>

export const previewInput = z.object({
  userId: z.number().int().positive().nullish(),
  type: typeRef.default("vacation"),
  startDate: dayString,
  endDate: dayString.nullish(),
  startHalf: half.default("full"),
  endHalf: half.default("full"),
  /** The request being edited: its own days are not counted twice. */
  excludeId: z.number().int().positive().nullish(),
})

export const listInput = z
  .object({
    from: dayString,
    to: dayString,
    userId: z.number().int().positive().nullish(),
    teamId: z.number().int().positive().nullish(),
    status: z
      .array(z.enum(["pending", "approved", "rejected", "cancelled"]))
      .max(4)
      .nullish(),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "before_start" })
  .refine((v) => Temporal.PlainDate.from(v.from).until(v.to).days <= 731, { path: ["to"], message: "too_long" })
