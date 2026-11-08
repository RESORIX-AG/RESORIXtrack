import { translate } from "./i18n-core"

/**
 * The document title from the deepest route's `staticData.titleKey`. Returned from a layout route's `head`,
 * so the server renders it too and client navigations update it.
 */
export function titleHead(locale: string, matches: readonly { staticData?: { titleKey?: string } }[]) {
  const key = matches.findLast((m) => m.staticData?.titleKey)?.staticData?.titleKey
  return { meta: [{ title: key ? `${translate(locale, key)} · RESORIXtrack` : "RESORIXtrack" }] }
}
