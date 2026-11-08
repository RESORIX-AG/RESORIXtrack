import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router"
import { Fingerprint, KeyRound } from "lucide-react"
import { useEffect, useEffectEvent, useState, useTransition } from "react"
import { z } from "zod"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldSeparator } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { authConfigQuery } from "@/features/auth/api"
import { AuthCard, AuthFooter } from "@/features/auth/components"
import { authErrorKey, safeNext } from "@/features/auth/lib"
import { authClient } from "@/lib/auth-client"
import { useT } from "@/lib/i18n"

export const Route = createFileRoute("/_auth/login")({
  staticData: { titleKey: "auth.sign_in_title" },
  validateSearch: z.object({ next: z.string().optional(), error: z.string().optional() }),
  beforeLoad: ({ context, search }) => {
    // safeNext keeps the target same-origin; framing is refused by CSP frame-ancestors and X-Frame-Options
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk
    if (context.bootstrap.me) throw redirect({ href: safeNext(search.next) })
    if (!context.bootstrap.company.setupComplete) throw redirect({ to: "/setup" })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(authConfigQuery),
  component: Login,
})

function Login() {
  const t = useT()
  const search = Route.useSearch()
  const router = useRouter()
  const qc = useQueryClient()
  const { data: config } = useQuery(authConfigQuery)
  const [step, setStep] = useState<"password" | "mfa">("password")
  const [error, setError] = useState<string | null>(search.error ? "auth.sso_failed" : null)
  const next = safeNext(search.next)

  async function done() {
    await qc.invalidateQueries({ queryKey: ["bootstrap"] })
    await router.navigate({ href: next })
  }

  const oidc = config?.oidc
  const passwordForm = !oidc?.only

  // conditional UI: the browser offers saved passkeys right in the email field's autofill
  const startAutofill = useEffectEvent(async (isCancelled: () => boolean) => {
    if (
      !passwordForm ||
      typeof PublicKeyCredential === "undefined" ||
      !PublicKeyCredential.isConditionalMediationAvailable
    )
      return
    if (!(await PublicKeyCredential.isConditionalMediationAvailable()) || isCancelled()) return
    const res = await authClient.signIn.passkey({ autoFill: true })
    if (!isCancelled() && res && !res.error) await done()
  })
  useEffect(() => {
    let cancelled = false
    void startAutofill(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <AuthCard
        title={step === "mfa" ? t("auth.mfa_title") : t("auth.sign_in_title")}
        description={step === "mfa" ? t("auth.mfa_sub") : undefined}
      >
        <div className="flex flex-col gap-5">
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          ) : null}
          {step === "password" ? (
            <QuickSignIn passkey={passwordForm} oidc={oidc} next={next} onError={setError} onDone={done} />
          ) : null}
          {step === "password" && passwordForm ? <FieldSeparator>{t("auth.or")}</FieldSeparator> : null}
          {step === "password" && passwordForm ? (
            <PasswordStep
              onError={setError}
              onMfa={() => {
                setError(null)
                setStep("mfa")
              }}
              onDone={done}
            />
          ) : null}
          {step === "mfa" ? (
            <MfaStep
              onError={setError}
              onBack={() => {
                setError(null)
                setStep("password")
              }}
              onDone={done}
            />
          ) : null}
        </div>
      </AuthCard>
      <AuthFooter />
    </>
  )
}

/** Passkey and single sign-on: Actions whose button shows the pending state until the browser returns. */
function QuickSignIn({
  passkey,
  oidc,
  next,
  onError,
  onDone,
}: {
  passkey: boolean
  oidc: { enabled: boolean; name: string } | undefined
  next: string
  onError: (key: string | null) => void
  onDone: () => Promise<void>
}) {
  const t = useT()
  const [pending, start] = useTransition()
  const passkeySignIn = async () => {
    onError(null)
    const res = await authClient.signIn.passkey()
    if (!res?.error) return onDone()
    const code = "code" in res.error ? res.error.code : ""
    onError(code === "AUTH_CANCELLED" ? null : "auth.passkey_failed")
  }
  const ssoSignIn = async () => {
    onError(null)
    const res = await authClient.signIn.social({
      provider: "oidc",
      callbackURL: next,
      errorCallbackURL: "/login?error=sso",
    })
    if (res.error) onError("auth.sso_failed")
  }
  return (
    <>
      {passkey ? (
        <Button variant="outline" size="lg" disabled={pending} onClick={() => start(passkeySignIn)}>
          {pending ? <Spinner data-icon="inline-start" /> : <Fingerprint data-icon="inline-start" />}
          {t("auth.sign_in_passkey")}
        </Button>
      ) : null}
      {oidc?.enabled ? (
        <Button variant={passkey ? "outline" : "default"} size="lg" disabled={pending} onClick={() => start(ssoSignIn)}>
          <KeyRound data-icon="inline-start" />
          {t("auth.sign_in_with", { name: oidc.name })}
        </Button>
      ) : null}
    </>
  )
}

function PasswordStep({
  onError,
  onMfa,
  onDone,
}: {
  onError: (key: string | null) => void
  onMfa: () => void
  onDone: () => Promise<void>
}) {
  const t = useT()
  const form = useAppForm({
    defaultValues: { email: "", password: "", remember: true },
    onSubmit: async ({ value }) => {
      onError(null)
      const res = await authClient.signIn.email({
        email: value.email.trim(),
        password: value.password,
        rememberMe: value.remember,
      })
      if (res.error) {
        onError(authErrorKey(res.error))
        form.setFieldValue("password", "")
        return
      }
      // with two-factor enabled the sign-in answers `{ twoFactorRedirect: true }` instead of a session
      if ("twoFactorRedirect" in res.data && res.data.twoFactorRedirect) return onMfa()
      await onDone()
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form}>
        <form.AppField name="email" validators={{ onBlur: z.string().trim().min(1, "common.required") }}>
          {(f) => <f.TextField label={t("common.email")} type="email" autoComplete="username webauthn" />}
        </form.AppField>
        <form.AppField name="password" validators={{ onBlur: z.string().min(1, "common.required") }}>
          {(f) => <f.TextField label={t("auth.password")} type="password" autoComplete="current-password" />}
        </form.AppField>
        <div className="flex items-center justify-between gap-3">
          <form.AppField name="remember">{(f) => <f.SwitchField label={t("auth.remember")} />}</form.AppField>
          <Link
            to="/forgot"
            className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("auth.forgot")}
          </Link>
        </div>
        <form.SubmitButton size="lg">{t("auth.sign_in")}</form.SubmitButton>
      </FormRoot>
    </form.AppForm>
  )
}

function MfaStep({
  onError,
  onBack,
  onDone,
}: {
  onError: (key: string | null) => void
  onBack: () => void
  onDone: () => Promise<void>
}) {
  const t = useT()
  const form = useAppForm({
    defaultValues: { code: "" },
    onSubmit: async ({ value }) => {
      onError(null)
      const code = value.code.replace(/\s/g, "")
      // six digits: authenticator app; anything else: a backup code
      const res = /^\d{6}$/.test(code)
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code })
      if (res.error) {
        const key = authErrorKey(res.error)
        onError(key)
        form.setFieldValue("code", "")
        if (key === "errors.mfa_expired") onBack()
        return
      }
      await onDone()
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form}>
        <form.AppField name="code" validators={{ onBlur: z.string().trim().min(6, "auth.mfa_code_help") }}>
          {(f) => (
            <f.TextField
              label={t("auth.mfa_code")}
              description={t("auth.mfa_code_help")}
              autoComplete="one-time-code"
              maxLength={24}
              className="font-mono tracking-widest"
            />
          )}
        </form.AppField>
        <form.SubmitButton size="lg">{t("auth.verify")}</form.SubmitButton>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t("common.back")}
        </Button>
      </FormRoot>
    </form.AppForm>
  )
}
