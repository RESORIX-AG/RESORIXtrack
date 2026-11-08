import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url"
import { type QueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { type ReactNode, Suspense, useEffect } from "react"
import { preload } from "react-dom"
import { BrandStyle } from "@/components/app/brand-style"
import type { Theme } from "@/components/app/theme"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider } from "@/lib/i18n"
import { bootstrapQuery } from "@/lib/session"
import appCss from "../styles.css?url"

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** i18n key of the page title (top bar, document title). */
    titleKey?: string
  }
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context }) => {
    const bootstrap = await context.queryClient.ensureQueryData(bootstrapQuery)
    return { bootstrap }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "color-scheme", content: "dark light" },
      { title: "RESORIXtrack" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
    // The CSP has no 'unsafe-eval': zod must not probe `new Function` (a CSP violation on every page). Set
    // before any module runs, since the bundler does not guarantee module order across chunks.
    scripts: [{ children: "globalThis.__zod_globalConfig={jitless:true}" }],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
})

function RootDocument({ children }: { children: ReactNode }) {
  const { data } = useSuspenseQuery(bootstrapQuery)
  // the text font starts downloading with the document instead of after the stylesheet has been parsed
  preload(interLatin, { as: "font", type: "font/woff2", crossOrigin: "anonymous" })
  return (
    <html lang={data.locale} className={data.theme === "system" ? undefined : data.theme} suppressHydrationWarning>
      <head>
        <HeadContent />
        <ThemeColor theme={data.theme} />
        <BrandStyle accent={data.company.brandAccent} />
      </head>
      <body>
        <I18nProvider locale={data.locale}>
          <TooltipProvider delay={400}>
            {children}
            {/* React hydrates Suspense boundaries after the shell: in its own one, the mark's effect runs in the
                same pass as the router outlet's boundary (the app layout), after the layout's effects */}
            <Suspense fallback={null}>
              <HydratedMark />
            </Suspense>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  )
}

/**
 * Sets `data-hydrated` on <html> once the page's effects (window shortcuts and other listeners) are attached.
 * End-to-end tests wait for it. Client-only, so the server markup stays identical.
 */
function HydratedMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = ""
  }, [])
  return null
}

/** Browser chrome colour: --background of each theme (hex, browsers do not take OKLCH here). */
const CHROME = { dark: "#0a0a0b", light: "#f4f6f9" } as const

function ThemeColor({ theme }: { theme: Theme }) {
  if (theme !== "system") return <meta name="theme-color" content={CHROME[theme]} />
  return (
    <>
      <meta name="theme-color" media="(prefers-color-scheme: light)" content={CHROME.light} />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content={CHROME.dark} />
    </>
  )
}
