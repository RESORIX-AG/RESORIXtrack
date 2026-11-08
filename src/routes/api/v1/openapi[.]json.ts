import { createFileRoute } from "@tanstack/react-router"
import { env } from "@/server/env"
import { requestActor } from "@/server/request-actor"
import { authenticate } from "@/server/rest/auth"
import { openApiDocument } from "@/server/rest/openapi"
import { errorResponse } from "@/server/rest/router"

/** OpenAPI 3.1 document of the REST API: for signed-in people or a valid API key. */
export const Route = createFileRoute("/api/v1/openapi.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          if (!(await requestActor(request.headers))) await authenticate(request)
          return Response.json(openApiDocument(env.baseUrl), { headers: { "Cache-Control": "no-store" } })
        } catch (err) {
          return errorResponse(err)
        }
      },
    },
  },
})
