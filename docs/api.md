# API

REST API for desktop apps, scripts and integrations: `https://<host>/api/v1/…`. The web app itself uses server functions, not this API.

| | |
|---|---|
| Reference (signed in) | `/api/v1/docs` |
| OpenAPI 3.1 | `/api/v1/openapi.json` (signed in or with an API key) |

## Authentication

API keys only; cookies are ignored on `/api/v1`.

1. Profile → API keys → *New key*: name, permissions (scopes), validity (30, 90, 180 or 365 days), your password.
2. Copy the key (`rt_…`); it is shown once.
3. Send it as `Authorization: Bearer rt_…`.

A key acts as its owner, narrowed to its scopes; it never sees more than the owner may. It stops working when it expires, is revoked, the owner changes or resets the password, or the account is deactivated. Administrators can switch API keys off company-wide (Settings → Security).

| Scope | Allows |
|---|---|
| `time:read` | Clock state, days, time entries, projects, balance, public holidays |
| `time:write` | Clock actions, offline sync, create, change and delete entries |
| `absences:read` | Vacation account, absence types, absences |
| `absences:write` | Request and cancel absences |
| `reports:read` | Reports, people list, and reading other people's entries, absences and accounts (leads and HR, within their scope) |

Send `X-Client: desktop/<version>` to mark entries as "Desktop app" in the change history.

```bash
H="Authorization: Bearer rt_..."
B=https://time.example.com/api/v1
curl -H "$H" $B/me
curl -H "$H" $B/clock
curl -X POST -H "$H" -H "X-Client: desktop/1.0" $B/clock/in
curl -H "$H" "$B/entries?from=2026-11-01&to=2026-11-30"
```

## App sign-in

A desktop or mobile app does not need the web UI to get a key: `POST /api/v1/auth/token` with email and password answers a key (shown once) for that person. When two-factor authentication is enabled, the first answer is `401 mfa_required`; the app asks for the authenticator code (or a backup code) and repeats the call with `code`.

```bash
curl -X POST $B/auth/token -H "Content-Type: application/json" -d '{
  "email": "anna@example.com", "password": "…", "code": "123456",
  "name": "Laptop at home", "scopes": ["time:read", "time:write"], "expiresInDays": 90
}'
# 201 {"token": "rt_…", "id": 12, "name": "Laptop at home", "scopes": ["time:read", "time:write"], "expiresAt": "2027-02-05T08:00:00.000Z"}
```

- `scopes` (default: all five) and `expiresInDays` (default 90, at most 365) are optional. `name` is shown under Profile → API keys, where the person can revoke the key.
- Same rules as the web sign-in: the failure throttle (`429` with `Retry-After` after repeated failures per address and email), the sign-in log (`token_issued`), inactive accounts refused, no password sign-in in OIDC-only mode (`403 oidc_only`, except within the break-glass window), and `403 mfa_required` when the company requires two-factor authentication the person has not set up yet (enrol in the web app first).
- At most 20 sign-ins in a burst per client address, then one every 5 seconds.

| Status | Code | Meaning |
|---|---|---|
| 401 | `invalid_credentials` | Wrong email or password, or the account is inactive |
| 401 | `mfa_required` | Two-factor authentication is on: repeat with `code` |
| 401 | `invalid_mfa` | The authenticator or backup code is wrong (a backup code works once) |
| 403 | `api_keys_disabled` | API keys are switched off company-wide |
| 403 | `oidc_only` | Only single sign-on is allowed |
| 403 | `mfa_required` | Two-factor authentication is required but not set up |
| 422 | `validation_error` | `fields` names the problem, e.g. an unknown scope |
| 429 | `too_many_requests` | Too many failed attempts; see `Retry-After` |

## Conventions

- Dates `YYYY-MM-DD` in the person's timezone; instants ISO 8601 UTC (`…Z`); durations in minutes.
- Clock actions are idempotent and accept an optional past time (`at`) for offline sync. A clock-in with a future time is refused. A clock-out with a time more than 2 minutes ahead (at most 24 h after the clock-in) is scheduled instead: the entry stays open, `GET /clock` shows it as `scheduledEnd`, the entry closes at exactly that time; `POST /clock/unschedule` cancels the plan. A break is simply a clock-out followed by a clock-in.
- Projects: `GET /projects` lists what the owner can book on and the company's `mode` (`off`, `optional`, `required`). Entries, `POST /clock/in` and offline sync take `projectId`. `POST /clock/switch` changes the project while working: the running entry ends and the next starts at the same second (no break, no legal-rest check). A clock-in never fails over its project: an inactive one is dropped.
- When the company enforces the legal minimums, a clock-in answers `409 break_required` (fields `required`, `taken`, `earliest`) or `409 rest_required` (fields `requiredMin`, `earliest`); `earliest` is the instant from which clocking in is allowed.
- Out-of-scope ids answer `404`.

## Errors

JSON, always:

```json
{ "error": { "code": "validation_error", "message": "Invalid body", "fields": { "start": "Required" } } }
```

| Status | Typical codes |
|---|---|
| 401 | `unauthorized` (missing, invalid or expired key); app sign-in: `invalid_credentials`, `mfa_required`, `invalid_mfa` |
| 403 | `insufficient_scope`, `forbidden`, `api_keys_disabled`; app sign-in: `oidc_only`, `mfa_required` |
| 404 | `not_found` |
| 409 | `period_signed_off`, `employment_ended`, `overlap`, `break_required`, `rest_required` |
| 422 | `validation_error` (with `fields`) |
| 429 | `too_many_requests` (per-key limit: burst 120, 2 per second; see `Retry-After`) |

## Endpoints

See the OpenAPI document at `/api/v1/openapi.json` or the reference at `/api/v1/docs`.
