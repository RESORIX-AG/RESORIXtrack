import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed } from "@/server/middleware"
import { auditLog, loginLog } from "@/server/services/admin-logs"
import { createBackup, deleteBackup, listBackups } from "@/server/services/backups"
import { requireAdmin } from "@/server/services/permissions"

const day = z.iso.date()

export const fetchBackups = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => listBackups(actor))

export const createBackupFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ includeAttachments: z.boolean() }))
  .handler(async ({ data, context: { actor } }) => {
    requireAdmin(actor)
    return createBackup({ includeAttachments: data.includeAttachments })
  })

export const deleteBackupFn = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ name: z.string().max(80) }))
  .handler(({ data, context: { actor } }) => {
    deleteBackup(actor, data.name)
    return { ok: true }
  })

export const auditFilters = z.object({
  userId: z.number().int().positive().nullable().default(null),
  entity: z.string().max(32).nullable().default(null),
  action: z.string().max(32).nullable().default(null),
  from: day.nullable().default(null),
  to: day.nullable().default(null),
})
export type AuditFilters = z.infer<typeof auditFilters>

// where a page continues: the previous page's `nextCursor`
const cursor = { cursor: z.string().max(48).nullable().default(null) }

export const fetchAudit = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(auditFilters.extend(cursor))
  .handler(({ data, context: { actor } }) => auditLog(actor, data))

export const loginFilters = z.object({
  q: z.string().max(254).nullable().default(null),
  success: z.boolean().nullable().default(null),
  from: day.nullable().default(null),
  to: day.nullable().default(null),
})
export type LoginFilters = z.infer<typeof loginFilters>

export const fetchLogins = createServerFn({ method: "GET" })
  .middleware([authed])
  .validator(loginFilters.extend(cursor))
  .handler(({ data, context: { actor } }) => loginLog(actor, data))

export const backupsQuery = queryOptions({ queryKey: ["admin", "backups"], queryFn: () => fetchBackups() })
export const auditQuery = (f: AuditFilters) =>
  infiniteQueryOptions({
    queryKey: ["admin", "audit", f],
    queryFn: ({ pageParam }) => fetchAudit({ data: { ...f, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
export const loginsQuery = (f: LoginFilters) =>
  infiniteQueryOptions({
    queryKey: ["admin", "logins", f],
    queryFn: ({ pageParam }) => fetchLogins({ data: { ...f, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
