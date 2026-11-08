import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ShieldAlert } from "lucide-react"
import { useT } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { securityQuery } from "./api"

/** Non-dismissable reminder while two-factor is required by policy and not set up yet. */
export function MfaBanner() {
  const t = useT()
  const me = useMe()
  const candidate = me.mfaRequired && !me.twoFactorEnabled
  // an account linked to single sign-on counts as compliant: ask the server only when it could matter
  const { data } = useQuery({ ...securityQuery, enabled: candidate })
  if (!candidate || !data?.mfaDue) return null
  return (
    <output className="flex w-full items-center gap-3 border-b bg-warning/14 px-4 py-2 text-sm md:px-6">
      <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">{t("profile.mfa.banner")}</span>
      <Link to="/profile" hash="mfa" className="shrink-0 font-medium underline underline-offset-4">
        {t("profile.mfa.enable")}
      </Link>
    </output>
  )
}
