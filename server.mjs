/**
 * Production HTTP server: static client assets (hashed files cached forever) + the TanStack Start handler.
 * Run after `pnpm build`: `node server.mjs` (PORT, HOST from the environment).
 */
import { serve } from "srvx"
import { staticMiddleware } from "srvx/static"
import app from "./dist/server/server.js"

// Must match PEER_HEADER in src/server/client-ip.ts: the TCP peer, which a client cannot forge.
const PEER_HEADER = "x-resorixtrack-peer"

const assets = staticMiddleware({ dir: "dist/client", maxAge: 31536000, immutable: true })
const publicFiles = staticMiddleware({ dir: "dist/client", maxAge: 3600 })

serve({
  port: Number(process.env.PORT ?? 8080),
  hostname: process.env.HOST ?? "0.0.0.0",
  middleware: [
    (req, next) => (new URL(req.url).pathname.startsWith("/assets/") ? assets(req, next) : publicFiles(req, next)),
  ],
  fetch: (req) => {
    req.headers.delete(PEER_HEADER)
    const peer = req.runtime?.node?.req.socket?.remoteAddress
    if (peer) req.headers.set(PEER_HEADER, peer)
    return app.fetch(req)
  },
  gracefulShutdown: true,
})
