/** Registers the offline service worker (production builds only; the dev server serves unbundled modules). */
let done = false

const register = () => void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {})

export function registerServiceWorker(): void {
  if (done || !import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  done = true
  if (document.readyState === "complete") register()
  else window.addEventListener("load", register, { once: true })
}

/** Drops the pages the service worker kept for offline use, so the next person on this device never sees them. */
export async function clearCachedPages(): Promise<void> {
  if (typeof caches === "undefined") return
  const keys = await caches.keys().catch(() => [])
  await Promise.all(keys.filter((key) => key.startsWith("rt-pages-")).map((key) => caches.delete(key)))
}
