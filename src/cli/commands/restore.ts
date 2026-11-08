import { parseArgs } from "node:util"
import { env } from "@/server/env"
import { BackupCryptoError } from "@/server/services/backup-crypto"
import { backupPassword, openBackup, restoreBackup } from "@/server/services/backups"
import { ask, confirm } from "../prompt"

export default {
  summary: "restore an encrypted backup (stop the app first)",
  async run(args: string[]) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { yes: { type: "boolean", short: "y" }, "ask-password": { type: "boolean" } },
    })
    const file = positionals[0]
    if (!file) {
      console.error("usage: rt restore <backup.zip.enc> [--yes] [--ask-password]")
      return 2
    }
    const password = values["ask-password"] ? await ask("Backup password: ", true) : backupPassword()
    let opened: Awaited<ReturnType<typeof openBackup>>
    try {
      opened = await openBackup(file, password)
    } catch (err) {
      if (err instanceof BackupCryptoError) {
        console.error(err.message)
        return 1
      }
      throw err
    }
    const m = opened.manifest
    console.log(`Backup from ${m.createdAt} (RESORIXtrack ${m.version}), ${Object.keys(m.files).length} files.`)
    if (!values.yes) {
      console.log(`This replaces the database at ${env.databasePath}. Stop the app and the worker first.`)
      if (!(await confirm("Continue?"))) return 1
    }
    const r = restoreBackup(opened)
    console.log(`Restored. ${r.attachments} attachments.`)
    console.log("Start the app again; pending migrations run automatically.")
    return 0
  },
}
