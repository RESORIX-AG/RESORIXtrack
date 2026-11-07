import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useBootstrap } from "@/lib/session"

const Toaster = ({ ...props }: ToasterProps) => {
  // "system" lets sonner follow the device itself
  const theme = useBootstrap().theme

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      // expanded so every Undo stays reachable without hovering the stack
      expand
      visibleToasts={3}
      gap={8}
      duration={4000}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // sonner's attribute selectors outrank plain utilities
          actionButton:
            "h-7! rounded-md! bg-primary! px-2.5! text-xs! text-primary-foreground! hover:bg-primary/80! focus-visible:ring-3! focus-visible:ring-ring/50!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
