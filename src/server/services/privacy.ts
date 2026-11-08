/**
 * Right of access (revDSG Art. 25): everything stored about a person as one JSON document. Secrets are
 * never included (password hashes, session tokens, API key hashes, two-factor secrets).
 */
import { asc, eq, inArray } from "drizzle-orm"
import { db } from "../db"
import * as s from "../db/schema"
import { iso, utcnow } from "../time"
import { getUserOr404 } from "./permissions"

const ms = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function omit<T extends object, K extends keyof T>(row: T, key: K): Omit<T, K> {
  const { [key]: _omitted, ...rest } = row
  return rest
}

const rows = <T>(q: { all: () => T[] }) => q.all()

export function exportPersonalData(userId: number) {
  const u = getUserOr404(userId)
  const absences = rows(
    db.select().from(s.absences).where(eq(s.absences.userId, userId)).orderBy(asc(s.absences.startDate)),
  )
  const absenceIds = absences.map((a) => a.id)
  const attachments = absenceIds.length
    ? rows(
        db
          .select()
          .from(s.attachments)
          .where(inArray(s.attachments.absenceId, absenceIds))
          .orderBy(asc(s.attachments.id)),
      )
    : []
  return {
    format: 2,
    exportedAt: iso(utcnow()),
    profile: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      teamId: u.teamId,
      timezone: u.timezone,
      locale: u.locale,
      timeFormat: u.timeFormat,
      employmentStart: u.employmentStart,
      employmentEnd: u.employmentEnd,
      birthDate: u.birthDate,
      vacationDaysPerYear: u.vacationDaysPerYear,
      capabilities: u.capabilities,
      legalWeeklyMaxHours: u.legalWeeklyMaxHours,
      recordingMode: u.recordingMode,
      argExempt: u.argExempt,
      regularNightWork: u.regularNightWork,
      notifyEmailOnCorrection: u.notifyEmailOnCorrection,
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
      isActive: u.isActive,
      createdAt: ms(u.createdAt),
      lastLoginAt: iso(u.lastLoginAt),
      passwordChangedAt: iso(u.passwordChangedAt),
    },
    teamRoles: rows(db.select().from(s.teamLeads).where(eq(s.teamLeads.userId, userId))).map((r) => ({
      teamId: r.teamId,
      role: r.role,
      validFrom: r.validFrom,
      validTo: r.validTo,
    })),
    schedules: rows(
      db
        .select()
        .from(s.workSchedules)
        .where(eq(s.workSchedules.userId, userId))
        .orderBy(asc(s.workSchedules.validFrom)),
    ).map((r) => omit(r, "userId")),
    entitlements: rows(db.select().from(s.vacationEntitlements).where(eq(s.vacationEntitlements.userId, userId))).map(
      (r) => omit(r, "userId"),
    ),
    adjustments: rows(
      db
        .select()
        .from(s.balanceAdjustments)
        .where(eq(s.balanceAdjustments.userId, userId))
        .orderBy(asc(s.balanceAdjustments.effectiveDate)),
    ).map((r) => omit(r, "userId")),
    timeEntries: rows(
      db.select().from(s.timeEntries).where(eq(s.timeEntries.userId, userId)).orderBy(asc(s.timeEntries.startAt)),
    ).map((r) => Object.assign(omit(r, "userId"), { startAt: iso(r.startAt), endAt: iso(r.endAt) })),
    absences: absences.map((r) => omit(r, "userId")),
    attachments: attachments.map((r) => omit(r, "storageName")),
    signoffs: rows(
      db.select().from(s.monthSignoffs).where(eq(s.monthSignoffs.userId, userId)).orderBy(asc(s.monthSignoffs.id)),
    ).map((r) => ({
      month: r.month,
      signedById: r.signedById,
      signedAt: iso(r.signedAt),
      note: r.note,
      digest: r.digest,
      seal: r.seal,
      reopenedAt: iso(r.reopenedAt),
      reopenReason: r.reopenReason,
    })),
    changeHistory: rows(
      db.select().from(s.revisions).where(eq(s.revisions.subjectUserId, userId)).orderBy(asc(s.revisions.id)),
    ).map((r) => Object.assign(r, { at: iso(r.at) })),
    notifications: rows(
      db.select().from(s.notifications).where(eq(s.notifications.userId, userId)).orderBy(asc(s.notifications.id)),
    ).map((r) => ({
      kind: r.kind,
      payload: r.payload,
      createdAt: iso(r.createdAt),
      readAt: iso(r.readAt),
    })),
    // linked accounts (password, single sign-on): provider and date only, never tokens or hashes
    signInMethods: rows(db.select().from(s.account).where(eq(s.account.userId, userId))).map((a) => ({
      provider: a.providerId,
      createdAt: ms(a.createdAt),
    })),
    // passkeys without their public keys or credential ids
    passkeys: rows(db.select().from(s.passkey).where(eq(s.passkey.userId, userId)).orderBy(asc(s.passkey.id))).map(
      (p) => ({
        name: p.name,
        createdAt: ms(p.createdAt),
        deviceType: p.deviceType,
        backedUp: p.backedUp,
      }),
    ),
    sessions: rows(db.select().from(s.session).where(eq(s.session.userId, userId)).orderBy(asc(s.session.id))).map(
      (r) => ({
        createdAt: ms(r.createdAt),
        updatedAt: ms(r.updatedAt),
        expiresAt: ms(r.expiresAt),
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
      }),
    ),
    apiKeys: rows(
      db
        .select()
        .from(s.apikey)
        .where(eq(s.apikey.referenceId, String(userId)))
        .orderBy(asc(s.apikey.id)),
    ).map((k) => ({
      name: k.name,
      start: k.start,
      permissions: k.permissions,
      createdAt: ms(k.createdAt),
      expiresAt: ms(k.expiresAt),
      lastRequest: ms(k.lastRequest),
      requestCount: k.requestCount,
    })),
    signInAttempts: rows(
      db.select().from(s.loginAttempts).where(eq(s.loginAttempts.userId, userId)).orderBy(asc(s.loginAttempts.id)),
    ).map((a) => ({
      at: iso(a.at),
      success: a.success,
      reason: a.reason,
      ip: a.ip,
      userAgent: a.userAgent,
    })),
  }
}
