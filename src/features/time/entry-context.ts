import type { PeriodView } from "./api"
import type { EntryContext } from "./entry-dialog"

export function entryContext(view: PeriodView, self: boolean): EntryContext {
  return {
    owner: view.user,
    self,
    today: view.today,
    lockedMonths: view.lockedMonths,
    reasonRequired: view.reasonRequired,
    canEdit: view.canEdit,
    entries: view.entries,
  }
}
