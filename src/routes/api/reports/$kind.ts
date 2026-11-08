import { createFileRoute } from "@tanstack/react-router"
import { FORMATS, REPORT_KINDS, renderReport } from "@/features/reports/render"
import { isOneOf } from "@/lib/guards"
import { toAppError } from "@/server/errors"
import { requestActor } from "@/server/request-actor"

const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status })

/**
 * Report download (session cookie): `/api/reports/<kind>?format=pdf|xlsx|csv&…` with the same parameters as
 * the report server functions. Scope and permissions come from the services.
 */
export const Route = createFileRoute("/api/reports/$kind")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const actor = await requestActor(request.headers)
          if (!actor) return fail(401, "unauthorized", "Please sign in")
          const kind = params.kind
          if (!isOneOf(REPORT_KINDS, kind)) return fail(404, "not_found", "Unknown report")
          const search = new URL(request.url).searchParams
          const format = search.get("format") ?? "pdf"
          if (!isOneOf(FORMATS, format)) return fail(400, "validation_error", "Unknown format")
          const file = await renderReport(actor, kind, format, search)
          const ascii = file.filename.replace(/[^\x20-\x7e]|["\\]/g, "_")
          // a copy backed by a plain ArrayBuffer, as Response requires
          return new Response(new Uint8Array(file.body), {
            headers: {
              "Content-Type": file.contentType,
              "Content-Length": String(file.body.byteLength),
              "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          })
        } catch (err) {
          const e = toAppError(err)
          if (e.code === "server_error") console.error("[report]", err)
          return Response.json({ error: e.toJSON() }, { status: e.status })
        }
      },
    },
  },
})
