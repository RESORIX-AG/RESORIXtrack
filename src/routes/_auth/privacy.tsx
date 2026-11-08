import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ButtonLink } from "@/components/ui/button"
import { privacyQuery } from "@/features/auth/api"
import { AuthCard } from "@/features/auth/components"
import { useT } from "@/lib/i18n"

/** Privacy notice (revDSG Art. 19): the administrator's text, or a short default. Public. */
export const Route = createFileRoute("/_auth/privacy")({
  staticData: { titleKey: "auth.privacy" },
  loader: ({ context }) => context.queryClient.ensureQueryData(privacyQuery),
  component: Privacy,
})

function Privacy() {
  const t = useT()
  const { data } = useSuspenseQuery(privacyQuery)
  const text = data.notice.trim() || t("auth.privacy_default", { company: data.company })
  return (
    <AuthCard title={t("auth.privacy")}>
      <div className="flex flex-col gap-4">
        <p className="text-sm whitespace-pre-line text-pretty">{text}</p>
        <ButtonLink variant="outline" render={<Link to="/" />}>
          {t("auth.back")}
        </ButtonLink>
      </div>
    </AuthCard>
  )
}
