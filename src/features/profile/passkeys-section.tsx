import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Fingerprint, Pencil, Plus, Trash2 } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConfirmDialog } from "@/components/app/confirm"
import { SettingsGroup } from "@/components/app/settings"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { authClient } from "@/lib/auth-client"
import { fmtDateTime } from "@/lib/format"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import {
  confirmPasskeyRegistration,
  deleteOwnPasskey,
  type fetchPasskeys,
  passkeysQuery,
  renameOwnPasskey,
  securityQuery,
} from "./api"

type Row = Awaited<ReturnType<typeof fetchPasskeys>>[number]

type FormError = { field: "name" | "password"; message: string }

function NameForm({
  initial,
  submitLabel,
  needsPassword = false,
  onSubmit,
}: {
  initial: string
  submitLabel: string
  /** Adding a passkey: confirm the password first */
  needsPassword?: boolean
  onSubmit: (name: string, password: string) => Promise<FormError | null>
}) {
  const { t } = useI18n()
  const form = useAppForm({
    defaultValues: { name: initial, password: "" },
    onSubmit: async ({ value }) => {
      const error = await onSubmit(value.name.trim(), value.password)
      if (error)
        form.setFieldMeta(error.field, (m) => ({
          ...m,
          isBlurred: true,
          errorMap: { ...m.errorMap, onServer: error.message },
        }))
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form}>
        <form.AppField name="name" validators={{ onBlur: z.string().trim().min(1, "common.required").max(60) }}>
          {(f) => <f.TextField label={t("common.name")} description={t("profile.passkey_name_help")} maxLength={60} />}
        </form.AppField>
        {needsPassword ? (
          <form.AppField name="password" validators={{ onBlur: z.string().min(1, "common.required") }}>
            {(f) => <f.TextField label={t("common.your_password")} type="password" autoComplete="current-password" />}
          </form.AppField>
        ) : null}
        <DialogFooter>
          <form.SubmitButton>{submitLabel}</form.SubmitButton>
        </DialogFooter>
      </FormRoot>
    </form.AppForm>
  )
}

const subscribeNever = () => () => {}
const hasWebAuthn = () => "PublicKeyCredential" in window

export function PasskeysSection() {
  const { t, intl, tError } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const { data } = useSuspenseQuery(passkeysQuery)
  const { data: sec } = useSuspenseQuery(securityQuery)
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "rename"; row: Row } | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["profile"] }), qc.invalidateQueries({ queryKey: ["bootstrap"] })])
  // assumed on the server; corrected after hydration without a mismatch
  const supported = useSyncExternalStore(subscribeNever, hasWebAuthn, () => true)

  return (
    <SettingsGroup
      title={t("profile.passkeys")}
      actions={
        supported ? (
          <Button variant="outline" onClick={() => setDialog({ kind: "add" })}>
            <Plus data-icon="inline-start" />
            {t("profile.add_passkey")}
          </Button>
        ) : null
      }
    >
      {data.length ? (
        data.map((p) => (
          <div key={p.id} className="flex min-h-14 items-center gap-3 px-5 py-2">
            <Fingerprint className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{p.name || p.provider || t("profile.passkey")}</span>
              <span className="truncate text-xs text-muted-foreground">
                {[
                  p.name ? p.provider : null,
                  p.createdAt
                    ? fmtDateTime(p.createdAt, { intl, tz: me.timezone, hour12: me.timeFormat === "12h" })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("profile.rename")}
              onClick={() => setDialog({ kind: "rename", row: p })}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              intent="negative"
              aria-label={t("common.delete")}
              onClick={() => setDeleting(p)}
            >
              <Trash2 />
            </Button>
          </div>
        ))
      ) : (
        <p className="flex min-h-14 items-center gap-3 px-5 py-3 text-sm text-muted-foreground">
          <Fingerprint className="size-5 shrink-0" aria-hidden />
          {t("profile.no_passkeys")}
        </p>
      )}

      <Dialog open={dialog != null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === "rename" ? t("profile.rename") : t("profile.add_passkey")}</DialogTitle>
          </DialogHeader>
          {dialog?.kind === "add" ? (
            <NameForm
              initial=""
              submitLabel={t("profile.add_passkey")}
              needsPassword={sec.hasPassword}
              onSubmit={async (name, password) => {
                try {
                  await confirmPasskeyRegistration({ data: { password } })
                } catch (err) {
                  return { field: errorFields(err)?.password ? "password" : "name", message: tError(err) }
                }
                const res = await authClient.passkey.addPasskey({ name })
                if (res?.error) return { field: "name", message: t("profile.passkey_failed") }
                setDialog(null)
                toast.success(t("profile.passkey_added"))
                await refresh()
                return null
              }}
            />
          ) : null}
          {dialog?.kind === "rename" ? (
            <NameForm
              initial={dialog.row.name}
              submitLabel={t("common.save")}
              onSubmit={async (name) => {
                try {
                  await renameOwnPasskey({ data: { id: dialog.row.id, name } })
                } catch (err) {
                  return { field: "name", message: tError(err) }
                }
                setDialog(null)
                await refresh()
                return null
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("profile.delete_passkey", { name: deleting?.name || deleting?.provider || t("profile.passkey") })}
        confirmLabel={t("common.delete")}
        onConfirm={async () => {
          if (!deleting) return
          await deleteOwnPasskey({ data: { id: deleting.id } })
          toast.success(t("profile.passkey_deleted"))
          await refresh()
        }}
      />
    </SettingsGroup>
  )
}
