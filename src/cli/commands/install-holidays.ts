import { parseArgs } from "node:util"
import { count, eq } from "drizzle-orm"
import { db, rawSqlite } from "@/server/db"
import { holidays } from "@/server/db/schema"
import { AppError } from "@/server/errors"
import { createCalendarFromPreset, topUpHolidays } from "@/server/services/holiday-calendars"
import { defaultPresetDays, holidayPresets } from "@/server/services/holiday-presets"

const USAGE =
  'usage: rt install-holidays --preset <key> [--days "Easter Monday,Whit Monday"] [--years 2026,2027] [--default] | --top-up'

/** Create (or complete) a public-holiday calendar from a Swiss preset; signed-off months are never changed. */
export default {
  summary: "install public holidays from a Swiss preset (e.g. CH-ZH), or --top-up all preset calendars",
  run(args: string[]) {
    const { values } = parseArgs({
      args,
      options: {
        preset: { type: "string" },
        years: { type: "string" },
        days: { type: "string" },
        default: { type: "boolean" },
        "top-up": { type: "boolean" },
      },
    })
    if (values["top-up"]) {
      const r = rawSqlite().transaction(() => topUpHolidays(undefined, "cli"))()
      for (const t of r.topped) console.log(`calendar #${t.calendarId}: ${t.added} holidays added for ${t.year}`)
      for (const m of r.missing) console.log(`calendar #${m.calendarId}: no holidays for ${m.year} (no preset)`)
      if (!r.topped.length && !r.missing.length) console.log("nothing to add")
      return 0
    }
    const years = values.years?.split(",").map((y) => Number(y.trim()))
    if (!values.preset || years?.some((y) => !Number.isInteger(y) || y < 1900 || y > 2200)) {
      console.error(USAGE)
      console.error(
        `presets: ${holidayPresets()
          .map((p) => p.key)
          .join(", ")}`,
      )
      return 2
    }
    try {
      const cal = rawSqlite().transaction(() =>
        createCalendarFromPreset(values.preset!, {
          years,
          presetDays: values.days?.split(",").map((d) => d.trim()) ?? defaultPresetDays(values.preset!),
          makeDefault: values.default ?? false,
          source: "cli",
        }),
      )()
      const n = db.select({ n: count() }).from(holidays).where(eq(holidays.calendarId, cal.id)).get()?.n ?? 0
      console.log(`${cal.name} (#${cal.id}): ${n} holidays${cal.isDefault ? ", default calendar" : ""}`)
      return 0
    } catch (err) {
      if (err instanceof AppError) {
        console.error(err.message)
        console.error(
          `presets: ${holidayPresets()
            .map((p) => p.key)
            .join(", ")}`,
        )
        return 1
      }
      throw err
    }
  },
}
