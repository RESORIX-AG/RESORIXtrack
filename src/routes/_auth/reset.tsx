import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ButtonLink } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AuthCard } from "@/features/auth/components"
import { authErrorKey } from "@/features/auth/lib"
import { newPasswordValidator, passwordsDiffer, useFragmentToken } from "@/features/auth/password-fields"
import { authClient } from "@/lib/auth-client"
import { useT } from "@/lib/i18n"

export const Route = createFileRoute("/_auth/reset")({
  staticData: { titleKey: "auth.reset_title" },
  component: Reset,
})

export function InvalidLink() {
  const t = useT()
  return (
    <AuthCard title={t("auth.link_invalid")} description={t("auth.link_invalid_sub")}>
      <ButtonLink render={<Link to="/forgot" />}>{t("auth.request_new_link")}</ButtonLink>
    </AuthCard>
  )
}

function Reset() {
  const t = useT()
  const router = useRouter()
  const token = useFragmentToken()
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: { password: "", confirm: "" },
    onSubmit: async ({ value }) => {
      setError(null)
      const res = await authClient.resetPassword({ newPassword: value.password, token: token ?? "" })
      if (res.error) {
        const key = authErrorKey(res.error)
        if (key === "errors.invalid_token") setInvalid(true)
        else setError(key)
        return
      }
      toast.success(t("auth.password_saved"))
      await router.navigate({ to: "/login" })
    },
  })
  if (token === null) return <Skeleton className="h-64 rounded-xl" />
  if (!token || invalid) return <InvalidLink />
  return (
    <AuthCard title={t("auth.reset_title")} description={t("auth.reset_sub")}>
      <form.AppForm>
        <FormRoot form={form}>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          ) : null}
          <form.AppField name="password" validators={{ onBlur: newPasswordValidator }}>
            {(f) => (
              <f.TextField
                label={t("auth.new_password")}
                description={t("auth.password_rules")}
                type="password"
                autoComplete="new-password"
              />
            )}
          </form.AppField>
          <form.AppField
            name="confirm"
            validators={{
              onChangeListenTo: ["password"],
              onBlur: ({ value, fieldApi }) => passwordsDiffer(value, fieldApi.form.getFieldValue("password")),
            }}
          >
            {(f) => <f.TextField label={t("auth.confirm_password")} type="password" autoComplete="new-password" />}
          </form.AppField>
          <form.SubmitButton size="lg">{t("auth.save_password")}</form.SubmitButton>
        </FormRoot>
      </form.AppForm>
    </AuthCard>
  )
}
