/**
 * Company-wide settings stored as key/value JSON with typed defaults (port of v1 services/settings.py).
 *
 * Settings that change figures (`VERSIONED_SETTINGS`) apply from a date: `settings` holds the value before
 * the first version, `setting_versions` each later value with the day it applies from. Calculations read the
 * value of each day (`settingsTimeline().at(date)`), so a change never reaches earlier days.
 */
import { asc, desc, eq, inArray } from "drizzle-orm"
import { isOneOf } from "@/lib/guards"
import type { Json } from "@/lib/json"
import { db } from "../db"
import { absences, balanceAdjustments, settings as settingsTable, settingVersions, timeEntries } from "../db/schema"
import { Validation } from "../errors"
import { localToday } from "../time"
import { ensureAfterLastSignOff } from "./locks"

export {
  DEFAULTS,
  RETIRED_SETTINGS,
  type SettingKey,
  type Settings,
  settingsSchema,
  VERSIONED_SETTINGS,
  type VersionedSetting,
} from "./settings.schemas"

import {
  DEFAULTS,
  RETIRED_SETTINGS,
  type SettingKey,
  type Settings,
  settingsSchema,
  VERSIONED_SETTINGS,
} from "./settings.schemas"

/** Settings anyone (even signed out) may read. */
export const PUBLIC_KEYS = [
  "company_name",
  "default_timezone",
  "default_locale",
  "setup_complete",
  "brand_accent",
] as const

const SETTING_KEYS = settingsSchema.keyof().options
const partialSettings = settingsSchema.partial()
const isVersioned = (key: string) => (VERSIONED_SETTINGS as readonly string[]).includes(key)

/** Stored rows over the defaults; a value that no longer validates (e.g. edited by hand) keeps the default. */
function withDefaults(rows: { key: string; value: unknown }[], base: Settings = DEFAULTS): Settings {
  const values: Settings = { ...base }
  for (const row of rows) {
    const parsed = partialSettings.safeParse({ [row.key]: row.value })
    if (parsed.success) Object.assign(values, parsed.data)
  }
  return values
}

export interface SettingsTimeline {
  /** The settings in force on local day `date` (YYYY-MM-DD). */
  at: (date: string) => Settings
  /** Days a versioned setting changes on, ascending. */
  changes: readonly string[]
}

export function settingsTimeline(): SettingsTimeline {
  const base = withDefaults(db.select().from(settingsTable).all())
  const versions = db
    .select()
    .from(settingVersions)
    .orderBy(asc(settingVersions.validFrom), asc(settingVersions.id))
    .all()
    .filter((v) => isVersioned(v.key))
  if (!versions.length) return { at: () => base, changes: [] }
  const changes: string[] = []
  const snapshots: Settings[] = []
  let current = base
  for (const v of versions) {
    current = withDefaults([v], current)
    if (changes.at(-1) === v.validFrom) snapshots[snapshots.length - 1] = current
    else {
      changes.push(v.validFrom)
      snapshots.push(current)
    }
  }
  return {
    changes,
    at: (date) => {
      const found = changes.findLastIndex((c) => c <= date)
      return found < 0 ? base : snapshots[found]
    },
  }
}

const companyToday = (base: Settings) => localToday(base.default_timezone)

export function getAllSettings(): Settings {
  const timeline = settingsTimeline()
  return timeline.at(companyToday(timeline.at("")))
}

export function getSetting<K extends SettingKey>(key: K): Settings[K] {
  if (isVersioned(key)) return getAllSettings()[key]
  const row = db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()
  return withDefaults(row ? [row] : [])[key]
}

/** Any time data yet? Before the first record a figure-changing setting simply changes (setup). */
function hasTimeData(): boolean {
  return (
    db.select({ id: timeEntries.id }).from(timeEntries).limit(1).get() != null ||
    db.select({ id: absences.id }).from(absences).limit(1).get() != null ||
    db.select({ id: balanceAdjustments.id }).from(balanceAdjustments).limit(1).get() != null
  )
}

function writeBase(key: string, value: Json): void {
  db.insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
    .run()
}

/**
 * Save settings. Figure-changing ones apply from `validFrom` (default today, never on a signed-off day);
 * unchanged values are skipped, so saving a whole form adds no versions.
 */
export function updateSettings(input: Partial<Record<string, unknown>>, opts: { validFrom?: string } = {}): Settings {
  const errors: Record<string, string> = {}
  const changes: [SettingKey, Json][] = []
  for (const [key, value] of Object.entries(input)) {
    if (RETIRED_SETTINGS.includes(key)) continue
    if (!isOneOf(SETTING_KEYS, key)) {
      errors[key] = "Unknown setting"
      continue
    }
    const parsed = settingsSchema.shape[key].safeParse(value)
    if (parsed.success) changes.push([key, parsed.data])
    else errors[key] = "Invalid value"
  }
  if (Object.keys(errors).length) throw new Validation("Invalid settings", { fields: errors })
  const versioned = changes.filter(([key]) => isVersioned(key))
  if (versioned.length) {
    const timeline = settingsTimeline()
    const from = opts.validFrom ?? companyToday(timeline.at(""))
    const changed = versioned.filter(([key, value]) => timeline.at(from)[key] !== value)
    if (changed.length && !hasTimeData()) {
      for (const [key, value] of changed) {
        db.delete(settingVersions).where(eq(settingVersions.key, key)).run()
        writeBase(key, value)
      }
    } else if (changed.length) {
      ensureAfterLastSignOff(from, "validFrom")
      for (const [key, value] of changed)
        db.insert(settingVersions)
          .values({ key, validFrom: from, value })
          .onConflictDoUpdate({ target: [settingVersions.key, settingVersions.validFrom], set: { value } })
          .run()
    }
  }
  for (const [key, value] of changes) if (!isVersioned(key)) writeBase(key, value)
  return getAllSettings()
}

/** Planned and past changes of the figure-changing settings, newest first (settings page). */
export function settingChanges(): { key: string; validFrom: string; value: Json }[] {
  return db
    .select({ key: settingVersions.key, validFrom: settingVersions.validFrom, value: settingVersions.value })
    .from(settingVersions)
    .where(inArray(settingVersions.key, [...VERSIONED_SETTINGS]))
    .orderBy(desc(settingVersions.validFrom), desc(settingVersions.id))
    .all()
}
