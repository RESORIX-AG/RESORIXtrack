import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { z } from "zod"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ButtonLink } from "@/components/ui/button"
import { authConfigQuery } from "@/features/auth/api"
import { AuthCard } from "@/features/auth/components"
import { authErrorKey } from "@/features/auth/lib"
import { authClient } from "@/lib/auth-client"
import { useT } from "@/lib/i18n"

export const Route = createFileRoute("/_auth/forgot")({
  staticData: { titleKey: "auth.forgot_title" },
  loader: ({ context }) => context.queryClient.ensureQueryData(authConfigQuery),
  component: Forgot,
})

function BackToLogin() {
  const t = useT()
  return (
    <ButtonLink variant="outline" render={<Link to="/login" />}>
      {t("auth.back_to_login")}
    </ButtonLink>
  )
}

function Forgot() {
  const t = useT()
  const { data: config } = useQuery(authConfigQuery)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      setError(null)
      const email = value.email.trim()
      const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset" })
      // same answer for known and unknown addresses (no account enumeration); only throttling is shown
      if (res.error?.status === 429) return setError(authErrorKey(res.error))
      setSentTo(email)
    },
  })

  if (config && !config.mailConfigured)
    return (
      <AuthCard title={t("auth.forgot_title")} description={t("auth.no_mail_server")}>
        <BackToLogin />
      </AuthCard>
    )
  if (sentTo)
    return (
      <AuthCard title={t("auth.check_inbox")} description={t("auth.reset_sent", { email: sentTo })}>
        <BackToLogin />
      </AuthCard>
    )
  return (
    <AuthCard title={t("auth.forgot_title")}>
      <form.AppForm>
        <FormRoot form={form}>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          ) : null}
          <form.AppField name="email" validators={{ onBlur: z.email("auth.email_invalid") }}>
            {(f) => <f.TextField label={t("common.email")} type="email" autoComplete="username" />}
          </form.AppField>
          <form.SubmitButton size="lg">{t("auth.send_link")}</form.SubmitButton>
          <ButtonLink variant="ghost" render={<Link to="/login" />}>
            {t("auth.back_to_login")}
          </ButtonLink>
        </FormRoot>
      </form.AppForm>
    </AuthCard>
  )
}
