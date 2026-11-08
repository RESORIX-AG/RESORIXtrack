# Instructions for coding agents

RESORIXtrack is a self-hosted time-tracking application by RESORIX AG: one TanStack Start app (React 19, SSR) with Drizzle on SQLite, Better Auth, Node 26, Docker Compose deployment. Version 1.x (Flask + Astro) lives in the git tag `v1.0.0`.

## Where to read

| Topic | Read |
|---|---|
| What the product is, features, license | [README.md](README.md) |
| Running locally, demo accounts, commands, tests, migrations, releasing | [docs/development.md](docs/development.md) |
| Architecture and design rules | [docs/architecture.md](docs/architecture.md), [docs/design.md](docs/design.md) |
| Production installation, environment variables, updates | [docs/installation.md](docs/installation.md), [.env.example](.env.example) |
| Security model and operator checklist | [docs/security.md](docs/security.md), [SECURITY.md](SECURITY.md) |
| Swiss labour law checks and retention | [docs/compliance.md](docs/compliance.md), [docs/privacy.md](docs/privacy.md) |
| Backups (encrypted) and restore | [docs/backup-restore.md](docs/backup-restore.md) |
| REST API and API keys | [docs/api.md](docs/api.md) |
| Administrator guide, user manual | [docs/admin-guide.md](docs/admin-guide.md), [docs/user-manual.md](docs/user-manual.md) |
| Branding, theme tokens, languages | [docs/customizing.md](docs/customizing.md) |
| License (AGPL-3.0-or-later, commercial option), third-party licenses | [LICENSING.md](LICENSING.md), [docs/third-party-licenses.md](docs/third-party-licenses.md) |
| Release notes | [CHANGELOG.md](CHANGELOG.md) |

`PLAN.md` (git-ignored, may be absent) holds the owner's private working notes; it is not documentation.

## Non-negotiables
1. Privacy: employees see only their own data, admins see no working times (HR does), leads see their teams only, API keys never exceed their owner and scopes. Out-of-scope ids answer NotFound.
2. Signed-off months are immutable on every level: services, database triggers, seal chain.
3. Every change to time data is logged with who, when, what and why, in the same transaction.
4. Swiss law (ArG, ArGV 1, OR, revDSG) as described in `docs/compliance.md`. Time records are kept at least 5 years.
5. Backups are always encrypted. Passwords are Argon2id. Never store or log a plaintext secret.
6. Tests are part of the work. Every write path tests permissions and sign-off locks.
7. Fix problems directly if you find them, without asking.

## Coding structure
- Business logic lives in synchronous services that take an Actor and throw typed errors. Server functions, REST, worker and CLI stay thin and call the same services.
- One source of truth for types: Drizzle schema for data, zod schemas for inputs, inferred everywhere else.
- Every query hits an index. No N+1. Aggregate a period in one pass.
- UI uses the shared kit only: shadcn components and tokens, the DataTable, charts, form kit and page scaffolding. No hex colours, no one-off styles. Follow `docs/design.md`.
- Every UI string exists in en, de, fr and it. German in Swiss spelling.
- Comments only for rationale a name cannot carry. Prefer clear names and small functions.
- Max 3000 lines per file, 200 lines per function.
- Always use the newest stable versions of every tool and dependency and their current recommended patterns. Check the latest docs before writing.
- Always format, lint, typecheck and test what you changed at the end of every change.
- Write text, docs and UI copy as short as possible. Never use an em dash.

## Git
Only the owner pushes. Do not commit or push unless asked.

## Checks before you finish

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm i18n:check
pnpm exec tsx scripts/licenses.ts --check
pnpm test            # vitest
pnpm test:e2e        # Playwright against a seeded production build
docker build -f docker/Dockerfile .   # the production image (slower)
```
