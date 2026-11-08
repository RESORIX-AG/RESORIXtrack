/**
 * Documents on absences (doctor's notes, scans). Health data: only the person, their leads/deputies and HR
 * can read them; they never appear in lists or notifications of anyone else. Files are stored under a random
 * name in env.attachmentsDir; the type is sniffed from the content, never trusted from the upload. Deletes
 * are soft (the file stays for the audit trail until the retention cleanup purges it).
 */
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { and, count, eq } from "drizzle-orm"
import { db } from "../db"
import { type Absence, type Attachment, attachments, type User } from "../db/schema"
import { env } from "../env"
import { Conflict, Forbidden, NotFound, Validation } from "../errors"
import { absenceTypesById } from "./absence-types"
import { getAbsence, isActiveState, visibleAbsence } from "./absences"
import { ensureOpenDates } from "./locks"
import { notify } from "./notifications"
import { type Actor, beforeCover, canManageUser, canViewUser, getUserOr404, seesDate } from "./permissions"
import { record, snapshot } from "./revisions"

export const MAX_ATTACHMENTS_PER_ABSENCE = 10
export const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"] as const
export type AllowedType = (typeof ALLOWED_TYPES)[number]

const ascii = (s: string) => new TextEncoder().encode(s)
const startsWith = (head: Uint8Array, sig: Uint8Array, at = 0) => sig.every((b, i) => head[at + i] === b)
const HEIC_BRANDS = ["ftypheic", "ftypheix", "ftypmif1", "ftyphevc"].map(ascii)

/** Content type from the first bytes, or null when it is not an allowed format. */
export function sniffType(head: Uint8Array): AllowedType | null {
  if (startsWith(head, ascii("%PDF-"))) return "application/pdf"
  if (startsWith(head, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (startsWith(head, Uint8Array.from([0xff, 0xd8, 0xff]))) return "image/jpeg"
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) return "image/webp"
  if (HEIC_BRANDS.some((b) => startsWith(head, b, 4))) return "image/heic"
  return null
}

/** Like werkzeug's secure_filename: ASCII letters, digits, `._-`; no path parts, no leading dots. */
export function safeFilename(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[/\\]/g, " ")
  return base
    .trim()
    .split(/\s+/)
    .join("_")
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 255)
}

export function attachmentsDir(): string {
  mkdirSync(env.attachmentsDir, { recursive: true })
  return env.attachmentsDir
}

export function attachmentPath(att: Pick<Attachment, "storageName">): string {
  return path.join(attachmentsDir(), path.basename(att.storageName))
}

export function addAttachment(
  actor: Actor,
  absenceId: number,
  upload: { filename: string; data: Uint8Array },
): Attachment {
  const { absence: a, owner } = visibleAbsence(actor, absenceId)
  if (actor.id !== owner.id && !canManageUser(actor, owner)) throw new Forbidden("Not allowed")
  const t = absenceTypesById().get(a.typeId)!
  if (!t.allowsAttachments)
    throw new Validation(`Attachments are not available for '${t.label}'`, { fields: { file: "not_allowed" } })
  if (!isActiveState(a.status)) throw new Conflict("This absence is closed", { code: "invalid_state" })
  if (!seesDate(actor, owner, a.startDate)) throw beforeCover(actor, owner)
  ensureOpenDates(owner, a.startDate, a.endDate)
  const { data } = upload
  if (!data.length) throw new Validation("The file is empty", { fields: { file: "empty" } })
  if (data.length > env.attachmentMaxMb * 1024 * 1024)
    throw new Validation(`The file is larger than ${env.attachmentMaxMb} MB`, { fields: { file: "too_large" } })
  const contentType = sniffType(data.subarray(0, 16))
  if (!contentType)
    throw new Validation("Only PDF, PNG, JPEG, WebP or HEIC files are allowed", { fields: { file: "type" } })
  const existing =
    db
      .select({ n: count() })
      .from(attachments)
      .where(and(eq(attachments.absenceId, a.id), eq(attachments.isDeleted, false)))
      .get()?.n ?? 0
  if (existing >= MAX_ATTACHMENTS_PER_ABSENCE)
    throw new Validation(`At most ${MAX_ATTACHMENTS_PER_ABSENCE} attachments per absence`, {
      fields: { file: "too_many" },
    })

  const storageName = randomBytes(16).toString("hex")
  const file = path.join(attachmentsDir(), storageName)
  writeFileSync(file, data, { flag: "wx", mode: 0o600 })
  try {
    const att = db
      .insert(attachments)
      .values({
        absenceId: a.id,
        filename: safeFilename(upload.filename) || `attachment.${contentType.split("/")[1]}`,
        contentType,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        storageName,
        uploadedById: actor.id,
      })
      .returning()
      .get()
    record({ entity: "attachment", row: att, action: "create", actor, subjectUserId: owner.id, before: null })
    if (actor.id !== owner.id)
      notify(owner.id, "attachment_added", { absence_id: a.id, actor_name: actor.user.name, filename: att.filename })
    return att
  } catch (err) {
    unlinkSync(file)
    throw err
  }
}

function loadVisible(actor: Actor, attachmentId: number): { att: Attachment; absence: Absence; owner: User } {
  const att = db.select().from(attachments).where(eq(attachments.id, attachmentId)).get()
  if (!att || att.isDeleted) throw new NotFound("Attachment not found")
  const absence = getAbsence(att.absenceId)
  const owner = getUserOr404(absence.userId)
  if (!canViewUser(actor, owner) || !seesDate(actor, owner, absence.endDate)) throw new NotFound("Attachment not found")
  return { att, absence, owner }
}

/** The attachment and its file path, if the actor may read it (the person, their leads, HR). */
export function getAttachmentFile(actor: Actor, attachmentId: number): { attachment: Attachment; file: string } {
  const { att } = loadVisible(actor, attachmentId)
  const file = attachmentPath(att)
  if (att.size === 0 || !existsSync(file)) throw new NotFound("Attachment file is missing")
  return { attachment: att, file }
}

export function deleteAttachment(actor: Actor, attachmentId: number, reason = ""): void {
  const { att, absence, owner } = loadVisible(actor, attachmentId)
  if (!(actor.isHr || att.uploadedById === actor.id || canManageUser(actor, owner))) throw new Forbidden("Not allowed")
  if (!isActiveState(absence.status)) throw new Conflict("This absence is closed", { code: "invalid_state" })
  if (!seesDate(actor, owner, absence.startDate)) throw beforeCover(actor, owner)
  ensureOpenDates(owner, absence.startDate, absence.endDate)
  const before = snapshot("attachment", att)
  const updated = db.update(attachments).set({ isDeleted: true }).where(eq(attachments.id, att.id)).returning().get()
  record({ entity: "attachment", row: updated, action: "delete", actor, subjectUserId: owner.id, before, reason })
}
