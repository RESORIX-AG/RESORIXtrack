import { openAsBlob } from "node:fs"
import { createFileRoute } from "@tanstack/react-router"
import { AppError } from "@/server/errors"
import { requestActor } from "@/server/request-actor"
import { backupPath } from "@/server/services/backups"

/** Download of an encrypted backup (administrators only; the file is delivered as stored, never decrypted). */
export const Route = createFileRoute("/api/admin/backups/$name")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const actor = await requestActor(request.headers)
        if (!actor?.isAdmin) return new Response("Not found", { status: 404 })
        let file: string
        try {
          file = backupPath(params.name)
        } catch (err) {
          return new Response(err instanceof AppError ? err.message : "Not found", { status: 404 })
        }
        const body = await openAsBlob(file)
        return new Response(body, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(body.size),
            "Content-Disposition": `attachment; filename="${params.name}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        })
      },
    },
  },
})
