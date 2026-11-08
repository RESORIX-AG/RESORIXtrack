/**
 * "Add time" outside "My time" (dashboard): opens the entry dialog in place, with this week's entries as its
 * context, instead of navigating away.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useT } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { periodQuery } from "./api"
import { entryContext } from "./entry-context"
import { EntryDialog } from "./entry-dialog"
import { todayIn } from "./lib"
import { periodParams } from "./period"

export function AddEntryButton({ label, size }: { label: string; size?: "default" | "lg" }) {
  const t = useT()
  const me = useMe()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [seq, setSeq] = useState(0)
  const period = periodQuery(periodParams(null, {}, todayIn(me.timezone)))
  const view = useQuery({ ...period, enabled: open }).data
  const prefetch = () => void qc.prefetchQuery(period)
  return (
    <>
      <Button
        variant="ghost"
        size={size}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={() => {
          setSeq((n) => n + 1)
          setOpen(true)
        }}
      >
        {open && !view ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
        {label}
      </Button>
      {view ? (
        <EntryDialog
          key={seq}
          open={open}
          onOpenChange={setOpen}
          target={{ date: view.today }}
          ctx={entryContext(view, true)}
          onHistory={() => undefined}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {open && !view ? t("common.loading") : ""}
      </span>
    </>
  )
}
