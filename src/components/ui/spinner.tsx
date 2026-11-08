import { Loader2Icon } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useT()
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t("common.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
