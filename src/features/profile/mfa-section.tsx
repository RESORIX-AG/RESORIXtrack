import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Copy, Download, ShieldCheck } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { SettingRow, SettingsGroup } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status-badge"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { authErrorKey } from "@/features/auth/lib"
import { authClient } from "@/lib/auth-client"
import { useT } from "@/lib/i18n"
import { securityQuery } from "./api"

// the QR encoder is only needed while enrolling: its own chunk, loaded when the dialog shows the code
const QrCode = lazy(() => import("./qr-code"))

function BackupCodes({ codes }: { codes: string[] }) {
  const t = useT()
  const text = codes.join("\n")
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-muted p-3 font-mono text-sm tabular">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            toast.success(t("common.copied"))
          }}
        >
          <Copy data-icon="inline-start" />
          {t("common.copy")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`RESORIXtrack\n\n${text}\n`], { type: "text/plain" }))
            const a = document.createElement("a")
            a.href = url
            a.download = "resorixtrack-backup-codes.txt"
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          <Download data-icon="inline-start" />
          {t("common.download")}
        </Button>
      </div>
    </div>
  )
}

/** Password prompt used by every two-factor action. */
function PasswordStep({
  submitLabel,
  destructive,
  onSubmit,
}: {
  submitLabel: string
  destructive?: boolean
  onSubmit: (password: string) => Promise<string | null>
}) {
  const t = useT()
  const form = useAppForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      const error = await onSubmit(value.password)
      if (error)
        form.setFieldMeta("password", (m) => ({
          ...m,
          isBlurred: true,
          errorMap: { ...m.errorMap, onServer: t(error) },
        }))
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form}>
        <form.AppField name="password" validators={{ onBlur: z.string().min(1, "common.required") }}>
          {(f) => <f.TextField label={t("common.your_password")} type="password" autoComplete="current-password" />}
        </form.AppField>
        <DialogFooter>
          <form.SubmitButton variant={destructive ? "destructive" : "default"}>{submitLabel}</form.SubmitButton>
        </DialogFooter>
      </FormRoot>
    </form.AppForm>
  )
}

function VerifyStep({ uri, onDone }: { uri: string; onDone: () => void }) {
  const t = useT()
  const secret = new URL(uri).searchParams.get("secret") ?? ""
  const form = useAppForm({
    defaultValues: { code: "" },
    onSubmit: async ({ value }) => {
      const res = await authClient.twoFactor.verifyTotp({ code: value.code.replace(/\s/g, "") })
      if (res.error) {
        form.setFieldMeta("code", (m) => ({
          ...m,
          isBlurred: true,
          errorMap: { ...m.errorMap, onServer: t(authErrorKey(res.error)) },
        }))
        return
      }
      onDone()
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form}>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <Suspense fallback={<Skeleton className="size-52 rounded-lg" />}>
            <QrCode value={uri} label={t("profile.mfa.qr")} />
          </Suspense>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm font-medium">{t("profile.mfa.manual_key")}</p>
            <p className="text-xs text-muted-foreground">{t("profile.mfa.manual_key_help")}</p>
            <code className="rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-sm select-all">
              {secret.match(/.{1,4}/g)?.join(" ")}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={async () => {
                await navigator.clipboard.writeText(secret)
                toast.success(t("common.copied"))
              }}
            >
              <Copy data-icon="inline-start" />
              {t("profile.mfa.copy_key")}
            </Button>
          </div>
        </div>
        <form.AppField
          name="code"
          validators={{ onBlur: z.string().regex(/^\s*\d{3}\s?\d{3}\s*$/, "profile.mfa.code_format") }}
        >
          {(f) => (
            <f.TextField
              label={t("profile.mfa.code_from_app")}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              className="font-mono tracking-widest"
            />
          )}
        </form.AppField>
        <DialogFooter>
          <form.SubmitButton>{t("profile.mfa.activate")}</form.SubmitButton>
        </DialogFooter>
      </FormRoot>
    </form.AppForm>
  )
}

type Flow =
  | { kind: "enable"; step: "password" | "verify" | "codes"; uri?: string; codes?: string[] }
  | { kind: "codes"; codes?: string[] }
  | { kind: "disable" }

export function MfaSection() {
  const t = useT()
  const qc = useQueryClient()
  const { data: sec } = useSuspenseQuery(securityQuery)
  const [flow, setFlow] = useState<Flow | null>(null)
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["profile"] }), qc.invalidateQueries({ queryKey: ["bootstrap"] })])

  const title =
    flow?.kind === "disable"
      ? t("profile.mfa.disable_title")
      : flow?.kind === "codes" || (flow?.kind === "enable" && flow.step === "codes")
        ? t("profile.mfa.backup_codes")
        : t("profile.mfa.enable")

  return (
    <SettingsGroup title={t("profile.mfa.title")}>
      <SettingRow
        label={
          sec.twoFactorEnabled ? (
            <StatusBadge tone="positive" icon={null}>
              <ShieldCheck className="size-3.5" aria-hidden />
              {t("profile.mfa.on")}
            </StatusBadge>
          ) : (
            <StatusBadge tone={sec.mfaDue ? "warning" : "neutral"} icon={sec.mfaDue ? "warning" : null}>
              {t("profile.mfa.off")}
            </StatusBadge>
          )
        }
        hint={
          sec.twoFactorEnabled && sec.backupCodesLeft != null
            ? t("profile.mfa.codes_left", { count: sec.backupCodesLeft })
            : !sec.twoFactorEnabled && sec.oidcLinked
              ? t("profile.mfa.via_sso")
              : undefined
        }
        control={
          <div className="flex flex-wrap gap-2">
            {sec.twoFactorEnabled ? (
              <>
                <Button variant="outline" onClick={() => setFlow({ kind: "codes" })}>
                  {t("profile.mfa.new_codes")}
                </Button>
                {!sec.mfaLocked ? (
                  <Button variant="ghost" intent="negative" onClick={() => setFlow({ kind: "disable" })}>
                    {t("profile.mfa.disable")}
                  </Button>
                ) : null}
              </>
            ) : sec.hasPassword ? (
              <Button onClick={() => setFlow({ kind: "enable", step: "password" })}>{t("profile.mfa.enable")}</Button>
            ) : null}
          </div>
        }
      />

      <Dialog
        open={flow != null}
        onOpenChange={(open) => {
          if (open) return
          // closing after enrolment or new codes: the codes were shown once
          setFlow(null)
          void refresh()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {flow?.kind === "enable" && flow.step === "verify" ? (
              <DialogDescription>{t("profile.mfa.scan")}</DialogDescription>
            ) : null}
            {(flow?.kind === "enable" && flow.step === "codes") || (flow?.kind === "codes" && flow.codes) ? (
              <DialogDescription>{t("profile.mfa.codes_once")}</DialogDescription>
            ) : null}
          </DialogHeader>
          {flow?.kind === "enable" && flow.step === "password" ? (
            <PasswordStep
              submitLabel={t("common.next")}
              onSubmit={async (password) => {
                const res = await authClient.twoFactor.enable({ password })
                if (res.error) return authErrorKey(res.error)
                if (res.data.method !== "totp") return "errors.generic"
                setFlow({ kind: "enable", step: "verify", uri: res.data.totpURI, codes: res.data.backupCodes })
                return null
              }}
            />
          ) : null}
          {flow?.kind === "enable" && flow.step === "verify" && flow.uri ? (
            <VerifyStep
              uri={flow.uri}
              onDone={() => {
                setFlow({ ...flow, step: "codes" })
                toast.success(t("profile.mfa.enabled"))
              }}
            />
          ) : null}
          {(flow?.kind === "enable" && flow.step === "codes") || (flow?.kind === "codes" && flow.codes) ? (
            <>
              <BackupCodes codes={flow.codes ?? []} />
              <DialogFooter>
                <Button
                  onClick={() => {
                    setFlow(null)
                    void refresh()
                  }}
                >
                  {t("profile.mfa.saved_codes")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
          {flow?.kind === "codes" && !flow.codes ? (
            <PasswordStep
              submitLabel={t("profile.mfa.new_codes")}
              onSubmit={async (password) => {
                const res = await authClient.twoFactor.generateBackupCodes({ password })
                if (res.error) return authErrorKey(res.error)
                setFlow({ kind: "codes", codes: res.data.backupCodes })
                return null
              }}
            />
          ) : null}
          {flow?.kind === "disable" ? (
            <PasswordStep
              destructive
              submitLabel={t("profile.mfa.disable")}
              onSubmit={async (password) => {
                const res = await authClient.twoFactor.disable({ password })
                if (res.error)
                  return res.error.code === "MFA_REQUIRED"
                    ? "profile.mfa.required_cannot_disable"
                    : authErrorKey(res.error)
                setFlow(null)
                toast.success(t("profile.mfa.disabled"))
                await refresh()
                return null
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  )
}
