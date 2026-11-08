# Development

Architecture: [architecture.md](architecture.md). UI rules: [design.md](design.md). Agent instructions: [AGENTS.md](../AGENTS.md).

## Setup

Requirements: Node 26, pnpm 10.12.1 (`npm install -g pnpm@10.12.1`; Node 26 no longer ships corepack), python3, make and g++, optionally Docker (Mailpit, image build).

`pnpm install` on Node 26 runs better-sqlite3's `node-gyp rebuild` install step: the package ships prebuilt Node-API binaries, but the step needs node-gyp (bundled with pnpm; otherwise `npm install -g node-gyp`), python3 and make on PATH, g++ when no prebuilt binary matches. The Docker build installs the same toolchain in its build stage only.

```bash
pnpm install
pnpm cli seed-demo --reset   # demo company in var/
pnpm dev                     # http://localhost:3210
pnpm worker                  # background jobs (optional)
docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit   # mail at http://localhost:8025
```

In development, secrets have insecure defaults, SMTP goes to `localhost:1025`, the setup code and HIBP check are off, data lives in `var/` (`RESORIXTRACK_DATA_DIR` changes it). Production defaults: [installation.md](installation.md#environment-reference).

## Demo accounts

`pnpm cli seed-demo --reset` wipes the dev database and creates three teams, projects and recent months of data. All passwords are `demo` (`--password` changes it). The command refuses to run in production. Emails end in `@example.nomail`, so no real mail is sent.

| Name | Email | Role | Team | Pensum | UI |
|---|---|---|---|---|---|
| RESORIXtrack Admin | `admin@example.nomail` | Administrator | none | 100 % | de |
| Nina Graf | `nina.graf@example.nomail` | Employee with HR and Projects | Operations | 80 % | de |
| Luca Bianchi | `luca.bianchi@example.nomail` | Lead | RF Engineering | 100 % | en |
| Anna Meier | `anna.meier@example.nomail` | Employee | RF Engineering | 100 % | de |
| Marc Dubois | `marc.dubois@example.nomail` | Employee | RF Engineering | 80 % | fr |
| Sofia Rossi | `sofia.rossi@example.nomail` | Deputy for 2 weeks | RF Engineering | 100 % | it |
| Jonas Keller | `jonas.keller@example.nomail` | Lead | Software & DSP | 100 % | de |
| Lea Schneider | `lea.schneider@example.nomail` | Employee | Software & DSP | 100 % | de |
| Noah Favre | `noah.favre@example.nomail` | Employee | Software & DSP | 60 % | fr |
| Mia Brunner | `mia.brunner@example.nomail` | Employee | Software & DSP | 100 % | en |
| Elena Kovac | `elena.kovac@example.nomail` | Lead | Operations | 100 % | en |
| Tim Baumann | `tim.baumann@example.nomail` | Employee, clocked in | Operations | 100 % | de |

RF Engineering's previous month is signed off.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server on :3210 |
| `pnpm worker` | Worker process |
| `pnpm cli <command>` | Operator CLI (`pnpm cli help`); in Docker `rt <command>` |
| `pnpm typecheck` | TypeScript |
| `pnpm lint` / `pnpm format` | oxlint (type-aware) and Biome |
| `pnpm test` | Vitest |
| `pnpm test:e2e` | Playwright against a seeded production build (`scripts/e2e-server.ts`) |
| `pnpm i18n:check` | Translation completeness |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm db:generate` / `pnpm db:migration` | New migration from the schema / custom SQL migration |
| `pnpm tsx scripts/licenses.ts --check` / `--write` | License allow-list / regenerate [third-party-licenses.md](third-party-licenses.md) |
| `docker compose build` | Production image |
| `scripts/smoke.sh` | Start the image with a throwaway `.env`, check health, sign-in page, `rt setup-code` (`SMOKE_IMAGE` picks the image) |

Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` and `pnpm build` before you finish.

## Tests

- Vitest, files next to the code (`foo.test.ts`); a fresh in-memory database per test (`src/test/db.ts`), builders in `src/test/factories.ts`.
- No coverage gate: `pnpm test` runs without coverage; `vitest run --coverage` would need `@vitest/coverage-v8`, which is not installed.
- Every write path tests permissions and sign-off locks.
- `src/server/isolation.test.ts` crawls every server function and REST endpoint for data leaks; add new functions to its `SPECS`.
- End-to-end tests live in `tests/e2e`.
- CI (`.github/workflows/ci.yml`): lint, typecheck, translations, licenses, Vitest and Playwright on every push and pull request, then the Docker image build and `scripts/smoke.sh`.

## Migrations

Drizzle Kit, SQL files in `drizzle/`, applied on start (`rt migrate`: encrypted `premigrate` backup when the database has people, then all pending migrations; `--check` exits 1 when some are pending). Opening a database refuses a v1 database (`alembic_version` table) and one with migrations this build does not know, before anything is written (`src/server/db/index.ts`).

1. Change `src/server/db/schema.ts`.
2. `pnpm db:generate`, review the SQL.
3. Triggers and data migrations: `pnpm db:migration` and write the SQL by hand.
4. Run the tests.

Released migrations are never edited; changes are additive and preserve data. `0001_guards.sql` and `0003_guards_v2.sql` hold the sign-off and change-log triggers.

## Translations

Every UI string exists in `src/i18n/{en,de,fr,it}`. The supported languages are defined once in `src/lib/locales.ts` (`LOCALES`, `localeSchema` for validators). Set keys with `scripts/i18n-set.ts` (all four languages at once); see [customizing.md](customizing.md#languages).

## Releasing

1. Bump `version` in `package.json`; add a section to [CHANGELOG.md](../CHANGELOG.md).
2. Run all checks, `pnpm test:e2e` and `docker compose build`.
3. Regenerate screenshots in `docs/screenshots/` when the UI changed.
4. `pnpm tsx scripts/licenses.ts --write` after dependency changes.
5. Tag and push (owner only). Operators update as in [installation.md](installation.md#updates).
