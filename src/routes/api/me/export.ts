import { createFileRoute } from "@tanstack/react-router"
import { requestActor } from "@/server/request-actor"
import { exportPersonalData } from "@/server/services/privacy"
import { localToday } from "@/server/time"

/** "Download my data" (revDSG Art. 25): everything stored about the signed-in person, as JSON. Session only. */
export const Route = createFileRoute("/api/me/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const actor = await requestActor(request.headers)
        if (!actor)
          return Response.json({ error: { code: "unauthorized", message: "Please sign in" } }, { status: 401 })
        const user = actor.user
        const body = JSON.stringify(exportPersonalData(user.id), null, 2)
        return new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="resorixtrack-my-data-${localToday(user.timezone ?? "Europe/Zurich")}.json"`,
            "Cache-Control": "no-store",
          },
        })
      },
    },
  },
})
