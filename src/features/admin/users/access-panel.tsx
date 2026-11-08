import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Download, Eye, EyeOff, Fingerprint, KeyRound, Mail, ShieldOff, Sparkles, UserX } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConfirmDialog } from "@/components/app/confirm"
import { SettingRow, SettingsGroup } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status-badge"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { fmtDateTime, fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { UserDetail } from "@/server/services/users"
import {
  anonymizeFn,
  exportUserFn,
  removePasskeysFn,
  resendInviteFn,
  resetMfaFn,
  setActiveFn,
  setPasswordFn,
  userRefsQuery,
} from "../api/users"
import { downloadJson, todayLocal } from "../lib"
import { EditorSheet, SheetSubmit, useAction } from "../ui"

function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <SettingRow
      label={label}
      hint={value}
      control={action ? <div className="flex flex-wrap gap-2 md:justify-end">{action}</div> : null}
    />
  )
}

export function AccessPanel({ user }: { user: UserDetail }) {
  const { t, intl } = useI18n()
  const me = useMe()
  // single sign-on only administrators have no password to confirm with
  const needsPassword = useSuspenseQuery(userRefsQuery).data.stepUpPassword
  const [dialog, setDialog] = useState<"password" | "mfa" | "passkeys" | "deactivate" | "anonymize" | null>(null)
  const resend = useAction(() => resendInviteFn({ data: { id: user.id } }), { success: t("admin.access.invite_sent") })
  const activate = useAction((active: boolean) => setActiveFn({ data: { id: user.id, active } }), {
    success: (r) => (r.ok ? t("admin.access.saved") : ""),
  })
  const exporter = useAction(() => exportUserFn({ data: { id: user.id } }), {
    invalidate: [],
    onSuccess: (data) => downloadJson(`resorixtrack-export-${user.id}.json`, data),
  })
  const anonymized = user.anonymizedAt != null
  const anonymizeFrom = user.anonymizeAllowedFrom
  const canAnonymize = !user.isActive && !anonymized && anonymizeFrom != null && anonymizeFrom <= todayLocal()
  const dt = (at: string | null) =>
    at ? fmtDateTime(at, { intl, tz: me.timezone, hour12: me.timeFormat === "12h" }) : t("admin.users.never")

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-2 xl:items-start">
      <SettingsGroup title={t("admin.access.sign_in")}>
        <Row
          label={t("admin.access.status")}
          value={
            user.invitePending ? t("admin.status.invited") : t("admin.access.last_login", { at: dt(user.lastLoginAt) })
          }
          action={
            user.invitePending && user.isActive ? (
              <Button variant="outline" onClick={() => resend.mutate(undefined)} disabled={resend.isPending}>
                <Mail data-icon="inline-start" />
                {t("admin.access.resend")}
              </Button>
            ) : null
          }
        />
        <Row
          label={t("admin.access.password")}
          value={user.invitePending ? t("admin.access.no_password") : t("admin.access.password_set")}
          action={
            !user.isSelf && !anonymized ? (
              <Button variant="outline" onClick={() => setDialog("password")}>
                <KeyRound data-icon="inline-start" />
                {t("admin.access.set_password")}
              </Button>
            ) : null
          }
        />
        <Row
          label={t("admin.access.mfa")}
          value={
            user.mfaEnabled ? (
              <StatusBadge tone="positive" icon="approved">
                {t("admin.access.on")}
              </StatusBadge>
            ) : (
              t("admin.access.off")
            )
          }
          action={
            user.mfaEnabled && !user.isSelf ? (
              <Button variant="outline" onClick={() => setDialog("mfa")}>
                <ShieldOff data-icon="inline-start" />
                {t("admin.access.reset_mfa")}
              </Button>
            ) : null
          }
        />
        <Row
          label={t("admin.access.passkeys")}
          value={user.passkeys ? t("admin.access.passkey_count", { count: user.passkeys }) : t("admin.access.none")}
          action={
            user.passkeys && !user.isSelf ? (
              <Button intent="negative" variant="outline" onClick={() => setDialog("passkeys")}>
                <Fingerprint data-icon="inline-start" />
                {t("admin.access.remove_passkeys")}
              </Button>
            ) : null
          }
        />
        <Row
          label={t("admin.access.account")}
          value={
            anonymized
              ? t("admin.status.anonymized")
              : user.isActive
                ? t("admin.status.active")
                : t("admin.status.inactive")
          }
          action={
            anonymized || user.isSelf ? null : user.isActive ? (
              <Button variant="outline" intent="negative" onClick={() => setDialog("deactivate")}>
                <UserX data-icon="inline-start" />
                {t("admin.access.deactivate")}
              </Button>
            ) : (
              <Button
                variant="outline"
                intent="positive"
                onClick={() => activate.mutate(true)}
                disabled={activate.isPending}
              >
                {t("admin.access.reactivate")}
              </Button>
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("admin.access.privacy")}>
        <Row
          label={t("admin.access.export")}
          value={t("admin.access.export_hint")}
          action={
            <Button variant="outline" onClick={() => exporter.mutate(undefined)} disabled={exporter.isPending}>
              <Download data-icon="inline-start" />
              {t("common.download")}
            </Button>
          }
        />
        {!anonymized ? (
          <Row
            label={t("admin.access.anonymize")}
            value={
              user.isActive
                ? t("admin.access.anonymize_deactivate_first")
                : anonymizeFrom == null
                  ? t("admin.access.anonymize_needs_end")
                  : canAnonymize
                    ? t("admin.access.anonymize_ready")
                    : t("admin.access.anonymize_from", {
                        date: fmtDay(anonymizeFrom, intl, { day: "numeric", month: "long", year: "numeric" }),
                      })
            }
            action={
              canAnonymize ? (
                <Button variant="outline" intent="negative" onClick={() => setDialog("anonymize")}>
                  {t("admin.access.anonymize")}
                </Button>
              ) : null
            }
          />
        ) : null}
      </SettingsGroup>

      {dialog === "password" ? (
        <PasswordSheet user={user} needsPassword={needsPassword} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "mfa" ? (
        <StepUpDialog
          title={t("admin.access.reset_mfa_title", { name: user.name })}
          confirmLabel={t("admin.access.reset_mfa")}
          success={t("admin.access.mfa_reset_ok")}
          needsPassword={needsPassword}
          run={(adminPassword) => resetMfaFn({ data: { id: user.id, adminPassword } })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "passkeys" ? (
        <StepUpDialog
          title={t("admin.access.remove_passkeys_title", { name: user.name })}
          confirmLabel={t("admin.access.remove_passkeys")}
          success={t("admin.access.passkeys_removed")}
          needsPassword={needsPassword}
          run={(adminPassword) => removePasskeysFn({ data: { id: user.id, adminPassword } })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === "deactivate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("admin.access.deactivate_title", { name: user.name })}
        description={t("admin.access.deactivate_message")}
        confirmLabel={t("admin.access.deactivate")}
        onConfirm={() => activate.mutateAsync(false)}
      />
      {dialog === "anonymize" ? (
        <AnonymizeDialog user={user} needsPassword={needsPassword} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  )
}

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_"
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
}

function PasswordSheet({
  user,
  needsPassword,
  onClose,
}: {
  user: UserDetail
  needsPassword: boolean
  onClose: () => void
}) {
  const newPasswordId = useId()
  const { t, tError } = useI18n()
  const [visible, setVisible] = useState(false)
  const save = useAction(
    (v: { password: string; adminPassword: string; notify: boolean }) => setPasswordFn({ data: { id: user.id, ...v } }),
    {
      success: t("admin.access.password_saved", { name: user.name }),
      silentError: true,
      onSuccess: onClose,
    },
  )
  const form = useAppForm({
    defaultValues: { password: "", adminPassword: "", notify: true },
    validators: {
      onChange: z.object({
        password: z.string().min(10, "errors.fields.password.too_short").max(256, "errors.fields.too_long"),
        adminPassword: needsPassword ? z.string().min(1, "errors.fields.required") : z.string(),
        notify: z.boolean(),
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
      title={t("admin.access.set_password_title", { name: user.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{t("admin.access.set_password")}</SheetSubmit>
        </>
      }
    >
      <form.AppForm>
        <FormRoot form={form}>
          <form.Field name="password">
            {(field) => (
              <Field data-invalid={field.state.meta.isBlurred && field.state.meta.errors.length ? true : undefined}>
                <FieldLabel htmlFor={newPasswordId}>{t("admin.access.new_password")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={newPasswordId}
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.isBlurred && field.state.meta.errors.length ? true : undefined}
                    className="font-mono"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      onClick={() => setVisible((v) => !v)}
                      aria-label={visible ? t("admin.access.hide") : t("admin.access.show")}
                    >
                      {visible ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                    <InputGroupButton
                      size="icon-xs"
                      onClick={() => {
                        field.handleChange(generatePassword())
                        setVisible(true)
                      }}
                      aria-label={t("admin.access.generate")}
                      title={t("admin.access.generate")}
                    >
                      <Sparkles />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {field.state.meta.isBlurred && field.state.meta.errors.length ? (
                  <FieldError>{t("errors.fields.password.too_short")}</FieldError>
                ) : null}
              </Field>
            )}
          </form.Field>
          <form.AppField name="notify">{(f) => <f.SwitchField label={t("admin.access.notify")} />}</form.AppField>
          {needsPassword ? (
            <form.AppField name="adminPassword">
              {(f) => (
                <f.TextField
                  label={t("common.your_password")}
                  description={t("admin.access.confirm_hint")}
                  type="password"
                  autoComplete="current-password"
                />
              )}
            </form.AppField>
          ) : null}
        </FormRoot>
      </form.AppForm>
    </EditorSheet>
  )
}

function AdminPasswordInput({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  const adminPasswordId = useId()
  const { t } = useI18n()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={adminPasswordId}>{t("common.your_password")}</FieldLabel>
      <Input
        id={adminPasswordId}
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

/** Confirm a sensitive action with the administrator's own password, when they have one. */
function StepUpDialog({
  title,
  confirmLabel,
  success,
  needsPassword,
  run,
  onClose,
}: {
  title: string
  confirmLabel: string
  success: string
  needsPassword: boolean
  run: (adminPassword: string) => Promise<unknown>
  onClose: () => void
}) {
  const { tError } = useI18n()
  const [pw, setPw] = useState("")
  const [error, setError] = useState("")
  // without the password field, errors go to a toast
  const action = useAction(() => run(pw), { success, silentError: needsPassword })
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={async () => {
        try {
          await action.mutateAsync(undefined)
        } catch (err) {
          if (needsPassword) setError(tError(err))
          throw err
        }
      }}
    >
      {needsPassword ? <AdminPasswordInput value={pw} onChange={setPw} error={error} /> : null}
    </ConfirmDialog>
  )
}

function AnonymizeDialog({
  user,
  needsPassword,
  onClose,
}: {
  user: UserDetail
  needsPassword: boolean
  onClose: () => void
}) {
  const { t, tError } = useI18n()
  const qc = useQueryClient()
  const [pw, setPw] = useState("")
  const [error, setError] = useState("")
  const run = useAction(() => anonymizeFn({ data: { id: user.id, adminPassword: pw } }), {
    success: t("admin.access.anonymized"),
    silentError: needsPassword,
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("admin.access.anonymize_title", { name: user.name })}
      description={t("admin.access.anonymize_message")}
      confirmLabel={t("admin.access.anonymize")}
      typeToConfirm={user.name}
      onConfirm={async () => {
        try {
          await run.mutateAsync(undefined)
          await qc.invalidateQueries({ queryKey: ["admin"] })
        } catch (err) {
          if (needsPassword) setError(tError(err))
          throw err
        }
      }}
    >
      {needsPassword ? <AdminPasswordInput value={pw} onChange={setPw} error={error} /> : null}
    </ConfirmDialog>
  )
}
