/**
 * Operator CLI:  pnpm cli <command> [options]   (in Docker: docker compose exec app rt <command>)
 *
 * Every file in ./commands is a command named after the file; its default export is a `Command`.
 * Discovery works in the Vite bundle (import.meta.glob) and under tsx (directory listing).
 */
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertProductionConfig } from "@/server/env"

export type Command = { summary: string; run: (args: string[]) => Promise<number | undefined> | number | undefined }
type Loader = () => Promise<unknown>

function discover(): Record<string, Loader> {
  let modules: Record<string, Loader>
  try {
    modules = import.meta.glob(["./commands/*.ts", "!./commands/*.test.ts"])
  } catch {
    // tsx: import.meta.glob is a Vite compile-time feature
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "commands")
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    modules = Object.fromEntries(files.map((f) => [f, () => import(path.join(dir, f))]))
  }
  return Object.fromEntries(Object.entries(modules).map(([file, loader]) => [path.basename(file, ".ts"), loader]))
}

function isCommand(v: unknown): v is Command {
  return typeof v === "object" && v !== null && "run" in v && typeof v.run === "function"
}

async function load(loader: Loader): Promise<Command> {
  const mod = await loader()
  const cmd = typeof mod === "object" && mod !== null && "default" in mod ? mod.default : null
  if (!isCommand(cmd)) throw new Error("command module without a default export")
  return cmd
}

async function main(): Promise<number> {
  const [name, ...rest] = process.argv.slice(2)
  const commands = discover()
  if (!name || name === "help" || !(name in commands)) {
    console.log("usage: pnpm cli <command> [options]   (Docker: rt <command>)\n")
    const names = Object.keys(commands).sort()
    const loaded = await Promise.all(names.map((key) => load(commands[key])))
    for (const [i, key] of names.entries()) console.log(`  ${key.padEnd(18)}${loaded[i].summary}`)
    return name && name !== "help" ? 1 : 0
  }
  // decrypt-backup also runs on a workstation with only the backup password at hand
  if (name !== "decrypt-backup") assertProductionConfig()
  return (await (await load(commands[name])).run(rest)) ?? 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
