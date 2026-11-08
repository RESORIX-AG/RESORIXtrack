/**
 * Background worker (separate process): scheduled jobs + heartbeat. Jobs are idempotent and each runs in
 * its own try/catch so one failure never stops the others. Heartbeat in app_state (read by /api/health and
 * `rt worker-alive`). `--once [job ...]` runs the given jobs (default: all) right away and exits.
 */
import { Cron } from "croner"
import { assertProductionConfig } from "@/server/env"
import { flushMail } from "@/server/services/mail"
import { getSetting } from "@/server/services/settings"
import { beat } from "./heartbeat"
import { JOBS } from "./jobs"

assertProductionConfig()

async function run(name: string, fn: () => unknown) {
  const started = Date.now()
  try {
    const result = await fn()
    console.log(
      `[worker] ${name} ok in ${Date.now() - started} ms${result != null ? `: ${JSON.stringify(result)}` : ""}`,
    )
  } catch (err) {
    console.error(`[worker] ${name} failed`, err)
  }
}

const onceAt = process.argv.indexOf("--once")
if (onceAt >= 0) {
  const names = new Set(process.argv.slice(onceAt + 1))
  // one after another, so the jobs' database writes and log lines never interleave
  // react-doctor-disable-next-line react-doctor/async-await-in-loop
  for (const job of JOBS.filter((j) => !names.size || names.has(j.name))) await run(job.name, job.run) // oxlint-disable-line eslint/no-await-in-loop
  // reminders are queued, not sent: let them go out before exiting
  await flushMail()
  process.exit(0)
}

const tz = getSetting("default_timezone")
const schedules = JOBS.map(
  (job) => new Cron(job.schedule, { timezone: tz, protect: true, name: job.name }, () => run(job.name, job.run)),
)
beat()
for (const job of JOBS.filter((j) => j.atStart)) void run(job.name, job.run)
schedules.push(new Cron("*/1 * * * *", { protect: true }, beat))
console.log(`[worker] started: ${JOBS.map((j) => `${j.name} (${j.schedule})`).join(", ")}`)

const stop = () => {
  for (const schedule of schedules) schedule.stop()
  process.exit(0)
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
