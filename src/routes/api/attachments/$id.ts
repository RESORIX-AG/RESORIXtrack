import { readFileSync } from "node:fs"
import { createFileRoute } from "@tanstack/react-router"
import { toAppError } from "@/server/errors"
import { requestActor } from "@/server/request-actor"
import { getAttachmentFile } from "@/server/services/attachments"

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"])

function contentDisposition(kind: "attachment" | "inline", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_")
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** Download of an absence document (session cookie; the person, their leads and HR only). `?inline=1` previews. */
export const Route = createFileRoute("/api/attachments/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const actor = await requestActor(request.headers)
          if (!actor)
            return Response.json({ error: { code: "unauthorized", message: "Please sign in" } }, { status: 401 })
          const id = Number(params.id)
          if (!Number.isInteger(id) || id <= 0)
            return Response.json({ error: { code: "not_found", message: "Attachment not found" } }, { status: 404 })
          const { attachment, file } = getAttachmentFile(actor, id)
          const inline =
            new URL(request.url).searchParams.get("inline") === "1" && INLINE_TYPES.has(attachment.contentType)
          return new Response(readFileSync(file), {
            headers: {
              "Content-Type": attachment.contentType,
              "Content-Length": String(attachment.size),
              "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", attachment.filename),
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; img-src 'self'",
              "Cross-Origin-Resource-Policy": "same-origin",
            },
          })
        } catch (err) {
          const e = toAppError(err)
          return Response.json({ error: e.toJSON() }, { status: e.status })
        }
      },
    },
  },
})
