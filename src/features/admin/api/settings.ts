import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { AppError } from "@/server/errors"
import { authed, tx } from "@/server/middleware"
import {
  brandingInfo,
  createAbsenceType,
  deleteAbsenceType,
  deleteLogo,
  dismissGettingStarted,
  getSettings,
  gettingStarted,
  listAbsenceTypesAdmin,
  saveLogo,
  saveSettings,
  setAccent,
  smtpStatus,
  updateAbsenceType,
} from "@/server/services/admin-settings"
import { MAX_LOGO_BYTES } from "@/server/services/admin-settings.schemas"
import { sendTestMail } from "@/server/services/mail"
import { requireAdmin } from "@/server/services/permissions"
import { settingsSchema } from "@/server/services/settings.schemas"
import { allTimezones } from "@/server/time"

const id = z.number().int().positive()
const variant = z.enum(["dark", "light"])

export const fetchAdminSettings = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => ({
    settings: getSettings(actor),
    branding: brandingInfo(),
    smtp: smtpStatus(),
    timezones: allTimezones(),
  }))

export const saveSettingsFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ changes: settingsSchema.partial(), validFrom: z.iso.date().optional() }))
  .handler(({ data, context: { actor } }) => {
    tx(() => saveSettings(actor, data.changes, data.validFrom))
    return { ok: true }
  })

export const uploadLogoFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ variant, dataBase64: z.string().max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 16) }))
  .handler(({ data, context: { actor } }) => saveLogo(actor, data.variant, Buffer.from(data.dataBase64, "base64")))

export const deleteLogoFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ variant }))
  .handler(({ data, context: { actor } }) => deleteLogo(actor, data.variant))

export const setAccentFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ accent: z.string().regex(/^(#[0-9a-fA-F]{6})?$/) }))
  .handler(({ data, context: { actor } }) => tx(() => setAccent(actor, data.accent)))

export const sendTestMailFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .handler(async ({ context: { actor } }) => {
    requireAdmin(actor)
    if (!smtpStatus().configured) throw new AppError("Email sending is not set up", { code: "smtp_not_configured" })
    await sendTestMail({ email: actor.user.email, name: actor.user.name, locale: actor.user.locale })
    return { to: actor.user.email }
  })

const typeInput = z.object({
  label: z.string().max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  category: z.enum(["vacation", "sick", "other"]),
  creditsTime: z.boolean(),
  deductsVacation: z.boolean(),
  requiresApproval: z.boolean(),
  allowsAttachments: z.boolean(),
  employeeCanRequest: z.boolean(),
  isActive: z.boolean(),
  sort: z.number().int().min(0).max(10000),
})

export const fetchAbsenceTypesAdmin = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => listAbsenceTypesAdmin(actor))

export const saveAbsenceTypeFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id: id.nullable(), key: z.string().max(32), input: typeInput }))
  .handler(({ data, context: { actor } }) =>
    tx(() =>
      data.id
        ? updateAbsenceType(actor, data.id, data.input)
        : createAbsenceType(actor, { ...data.input, key: data.key }),
    ),
  )

export const patchAbsenceTypeFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id, patch: typeInput.partial() }))
  .handler(({ data, context: { actor } }) => tx(() => updateAbsenceType(actor, data.id, data.patch)))

export const deleteAbsenceTypeFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ id }))
  .handler(({ data, context: { actor } }) => {
    tx(() => deleteAbsenceType(actor, data.id))
    return { ok: true }
  })

export const fetchGettingStarted = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => gettingStarted(actor))

export const dismissGettingStartedFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ dismissed: z.boolean() }))
  .handler(({ data, context: { actor } }) => {
    tx(() => dismissGettingStarted(actor, data.dismissed))
    return { ok: true }
  })

export const adminSettingsQuery = queryOptions({ queryKey: ["admin", "settings"], queryFn: () => fetchAdminSettings() })
export const absenceTypesAdminQuery = queryOptions({
  queryKey: ["admin", "absence-types"],
  queryFn: () => fetchAbsenceTypesAdmin(),
})
export const gettingStartedQuery = queryOptions({
  queryKey: ["admin", "getting-started"],
  queryFn: () => fetchGettingStarted(),
})
