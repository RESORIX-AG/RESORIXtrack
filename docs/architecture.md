# Architecture

```
browser ──(SSR HTML + hydration)──► TanStack Start (Node 26, one process)
   │  server functions (RPC, POST/GET, CSRF-checked, cookie session)          ┌──────────────┐
   │  /api/auth/*  Better Auth (sessions, 2FA, API keys)                      │ SQLite (WAL) │
   │  /api/v1/*    REST for API keys (OpenAPI at /api/v1/openapi.json)  ──────►  var/ or /data │
   │  /branding/*  logos                                                      └──────────────┘
worker (separate Node process: nightly backup, reminders, retention cleanup, weekly seal check, holiday top-up, heartbeat; `--once`)
cli    (`pnpm cli`, in Docker `rt`: migrate, create-admin, reset-password, setup-code, seed-demo, backup, restore, decrypt-backup, anonymize, install-holidays, send-reminders, verify-signoffs, worker-alive)
```

- **One service layer** (`src/server/services`) used by server functions, the REST API, the worker and the CLI.
  Services are synchronous and take an `Actor` (user + capabilities + led teams); transactions via `tx()`.
- **Server functions** (`src/features/*/api.ts`) are the UI's API: typed end to end, validated with zod.
- **REST API** (`src/server/rest`, mounted at `/api/v1/*`) for scripts and desktop clients: Better Auth API keys with
  scopes (`time:read|write`, `absences:read|write`, `reports:read`; others' data also needs `reports:read`), the
  key's owner as actor, writes on own records only, per-key rate limit, JSON errors `{ error: { code, message, fields } }`.
  One endpoint table drives routing, validation, response shaping and the OpenAPI 3.1 document
  (`/api/v1/openapi.json`, reference page `/api/v1/docs`).
- **Isolation crawler** (`src/server/isolation.test.ts`) calls every server function and REST endpoint as seven
  personas against everyone else's ids; a new server function fails the test until it is classified there.
- **Auth**: Better Auth with numeric ids on our `users` table, Argon2id hashes, DB sessions
  (list/revoke), TOTP + backup codes, rate limits, HIBP check. Invitations use our `auth_tokens`; password
  resets Better Auth's verification table.
- **Dated rules and terms**: figure-changing settings (`setting_versions`), a person's terms incl. timezone
  (`user_terms_history`) and employment periods (`employment_history`) apply from a day on; calculations read the
  values of each day (`services/timeline.ts`, `settingsTimeline()`), so a change never rewrites earlier days.
- **Integrity**: services check sign-off locks; SQLite triggers (drizzle/0001_guards.sql, 0011_dated_terms.sql) enforce them again;
  sign-off seals form a per-person HMAC chain over RFC 8785 JSON; the revisions table is append-only.
- **UI data flow** (React 19 + Compiler, no manual `useMemo`/`useCallback`): route loaders await only what the first
  paint needs; secondary sections read `useSuspenseQuery` inside `SectionBoundary` (Suspense + inline retry), so the
  HTML streams. Tabs stay mounted in `TabPanel` (`<Activity>`). Period steps (`PeriodNav` + `PeriodContent`) are
  Transitions that slide with a view transition (`lib/period-transition.ts`). Optimistic writes use `useOptimistic`
  inside an Action, then invalidate the queries. Small forms without field validation are native form Actions
  (`PendingButton`, `ReasonDialog`, `ConfirmDialog`); validated forms use the form kit. Charts, the command palette
  dialog, the phone drawer and the 2FA QR code load on demand (`lazy`).
