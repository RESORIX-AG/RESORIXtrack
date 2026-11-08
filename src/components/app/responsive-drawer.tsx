import type { ReactNode, Ref } from "react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

/** ResponsiveDialog below `md`: a bottom drawer with a scrolling body and a fixed footer. */
export default function ResponsiveDrawer({
  open,
  onOpenChange,
  title,
  description,
  srDescription,
  className,
  footer,
  footerRef,
  meta,
  wrap,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  srDescription: boolean
  className?: string
  footer?: ReactNode
  /** where `OverlayActions` from the body render */
  footerRef: Ref<HTMLDivElement>
  meta?: ReactNode
  /** wraps body and footer (the dialog's form, when it has an action) */
  wrap: (node: ReactNode) => ReactNode
  children: ReactNode
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="max-h-[80dvh] shadow-overlay">
        <DrawerHeader className="border-b px-5 pt-2 pb-3 text-left">
          <DrawerTitle className="text-base font-semibold">{title}</DrawerTitle>
          <DrawerDescription className={srDescription ? "sr-only" : undefined}>{description}</DrawerDescription>
          {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
        </DrawerHeader>
        {wrap(
          <>
            <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)}>{children}</div>
            <DrawerFooter
              ref={footerRef}
              className="mt-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] empty:hidden"
            >
              {footer}
            </DrawerFooter>
          </>,
        )}
      </DrawerContent>
    </Drawer>
  )
}
