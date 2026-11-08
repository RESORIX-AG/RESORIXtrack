import { useQueryClient } from "@tanstack/react-query"
import { Link, useRouter } from "@tanstack/react-router"
import { KeyRound, LogOut, ShieldCheck, UserRound } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { clearCachedPages } from "@/features/clock/register-sw"
import { authClient } from "@/lib/auth-client"
import { initials } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useBootstrap, useMe } from "@/lib/session"

export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarFallback className="bg-gradient-brand text-[11px] font-semibold text-white">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export function UserMenu() {
  const t = useT()
  const me = useMe()
  const b = useBootstrap()
  const router = useRouter()
  const qc = useQueryClient()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="rounded-full" aria-label={t("nav.account_menu")} />}
      >
        <PersonAvatar name={me.name} className="size-8" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{me.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{me.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/profile" />}>
          <UserRound />
          {t("nav.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/profile" hash="mfa" />}>
          <ShieldCheck />
          {t("profile.mfa.title")}
        </DropdownMenuItem>
        {b.company.apiTokensEnabled ? (
          <DropdownMenuItem render={<Link to="/profile" hash="tokens" />}>
            <KeyRound />
            {t("profile.tokens")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut()
            await clearCachedPages()
            qc.clear()
            await router.navigate({ to: "/login" })
          }}
        >
          <LogOut />
          {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
