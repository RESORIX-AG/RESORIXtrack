# Changelog

## 2.0.0 (unreleased)

Complete rewrite.

- Rules and terms apply from a date and never rewrite earlier days: figure-changing settings (Swiss law, holiday mode, full-time hours) and a person's terms (team, holiday calendar, timezone, vacation days, weekly maximum, time recording, senior executive, regular night work) take a *Changes apply from* date; moving people between teams and changing a team's or the company's calendar apply from today, never before the last signed-off month. The timezone is set by HR or an administrator (default: the company's); employees no longer change it in their profile, business trips need no change.
- Rehiring: a former employee gets a new employment period; the earlier one stays as it was. Moving the employment start or end only checks the days that actually change. The first schedule always covers the employment start (an earlier start gets the first schedule copied). Rehiring also works for people without a recorded employment start after a signed-off month (migration 0012).
- Vacation always follows the scheduled working days (enter full-time days for a 5-day week) and is rounded up to the next half day; the *Pro-rate vacation* switch is gone. Check the vacation days of part-time staff with fewer working days that were entered already reduced.
- A sick day after part of the day's work credits only what the schedule still lacks.
- Swiss law: breaks per working day (a night shift across midnight is one day; 15 and 30 min in one piece, 60 min in pieces of at least 15 min), new finding for more than 5½ h without a break (ArGV 1 Art. 18), Saturday-night work counts as Sunday work without work on Sunday, the clock-in checks group night shifts like the findings.
- Fixes from a review of the whole code base: deputies no longer see findings from before their cover in the compliance report; a forgotten clock-out is capped at 24 h when reporting sick or deactivating; balances as of a past date ignore later bookings; restores leave no unencrypted copies behind; a reopened month keeps its holiday calendar; the only HR person signs off their own month; leavers stay in past reports; administrators cannot add people to teams they lead or change their own team or holiday calendar; account linking routes are closed; and more.
- No migration path from 1.x: `rt import-v1`, 1.x seal verification and the 1.x work log table are removed (migration 0011 drops `work_logs`; `rt migrate` takes an encrypted backup first). The time credit for Sunday and holiday work now covers the legal Sunday and holiday windows.
- Faster team overview, balances and labour-law reports for larger teams (one load per person).

- Projects live on the time entries: an entry carries a project, the clock picks the project at clock-in and switches it while working (the entry ends and the next starts at the same second, no break), the week view shows each block in its project's colour. The separate work log is gone; "Required" means every work entry has a project. Sign-off seals cover each entry's project. REST: `GET /projects`, `POST /clock/switch`, `projectId` on entries and clock actions.
- Deleting a time entry always needs a reason, own entries of today included; the deletion is logged and the person is notified when someone else deletes.
- Stack: TanStack Start (React 19, SSR), Drizzle + SQLite, Better Auth, shadcn/ui on Base UI, Node 26. One service layer for the web app, REST API, worker and CLI (`rt`).
- Clocking: clock in and out, at a custom time or scheduled for later ("clock out later" closes the entry at the chosen time; cancel any time, "Clock out now" ends it earlier). A break is a clock-out: there is no pause state; legacy break entries are retired by migration 0006. Optional block of clock-ins before the legal minimum break and daily rest (ArG Art. 15, 15a; setting, on by default).
- New UI: calmer dark and light themes that follow the device (or System / Light / Dark in the top bar), less text, mobile tab bar, command palette, accessible keyboard use.
- Period totals (month, week, timesheet, team) count complete days only: today is shown as in progress with its time so far, so a running day no longer shows a deficit.
- Long lists render only the rows in view (TanStack Virtual); the audit and sign-in logs load older entries while scrolling instead of page buttons.
- Swiss law: checks for breaks, daily rest, day span, night and Sunday work, weekly maximum, Überzeit per day and year, consecutive days, minimum vacation; full, simplified or waived recording per person; labour-law report; retention setting (minimum 5 years). See [docs/compliance.md](docs/compliance.md).
- Sunday, holiday and night work: compensatory rest check (ArG Art. 20), Sunday/holiday supplement (default 50 %) reported for payroll or credited as time, 10 % time credit for regular night work (Art. 17b), Sunday/holiday/night hours in the timesheet and balances exports.
- Public holidays: one form for a new calendar (name, canton or none, days), canton presets (list or map), statutory days plus the optional and commune days the company ticks, topped up with next year's holidays every 1 October, optional company days in one click. Every holiday change is in the audit log. The City of Fribourg preset is gone: it had the canton's days, and migration 0007 turns its calendars into canton FR.
- Public holidays page for everyone: the calendar that applies to you (assigned personally, your team's or the company default), year by year, read-only; `GET /api/v1/holidays`. The administration entry is now *Holiday calendars*.
- Italian as fourth language (UI, emails, PDF and spreadsheet exports).
- revDSG: privacy notice page, record of processing template, anonymisation only after the retention period.
- Sign-in: passkeys, single sign-on via OpenID Connect (e.g. Pocket ID, optional OIDC-only mode with break-glass), sessions listed and revocable per device.
- API: Better Auth API keys with scopes `time`, `absences`, `reports`; OpenAPI 3.1 at `/api/v1/openapi.json`, reference at `/api/v1/docs`; per-key rate limit. Apps obtain a key by signing in with email, password and the two-factor code (`POST /api/v1/auth/token`), as in 1.x.
- Security: CSP with per-request nonces, CSRF origin check, sign-off seals in RFC 8785 JSON, weekly integrity check by the worker.
- Security audit (November 2026):
  - Two-factor "required" is enforced on the server: until it is set up only the profile works; a password alone gets no app key; people with a passkey or single sign-on but no TOTP sign in with those.
  - Better Auth's HTTP routes for API keys, password change and profile updates are closed, so keys and passwords only change through the app's checks; keys without expiry are refused.
  - Adding a passkey needs the password and is mailed to the person; passkeys must verify their owner; "trust this device" is never granted.
  - Nobody credits, schedules, approves, reopens or grants rights to themselves, HR and administrators included, unless nobody else could (the only HR person without a lead, the only administrator); user changes log capabilities and labour-law settings.
  - Signed-off months keep their holiday calendar (migration 0010): assigning another calendar changes open months only.
  - A lead or deputy with a start date sees and changes members' data from that day on only; leads without one see everything.
  - Note fields say to leave out health and other personal details: they stay with the time records after anonymisation.
  - Documents of absences in signed-off months are locked (migration 0009); counting fields of absence types in use are fixed.
  - Client address from the TCP peer, never `X-Real-IP`; password confirmations in a session are throttled; unknown emails are always masked in the sign-in log.
  - `OIDC_ONLY` also blocks password resets and invitation passwords; administrators cannot re-invite people who signed in before.
  - Reset tokens are stored hashed; web server and `rt` refuse weak secrets; restore sets current documents aside; backup headers with absurd key-derivation costs are refused; logos and documents keep their strict CSP.
  - Sign-out clears the pages kept for offline use; project search shows only bookable projects; CSV headers are guarded against formulas.
- Backups: same encrypted RTBK1 format, now including logos and per-file checksums; `rt restore` refuses 1.x archives.

## 1.0.0 – 2026-11-06

First public release.

- One-click clocking (web, keyboard shortcuts, offline queue, clock in with a custom time, clock out at a custom time or later: the entry closes automatically), time and vacation accounts, versioned work schedules; per-person 24-hour or 12-hour time format. A break is simply a clock-out; there is no separate pause state (migration 0003 retires old break entries outside signed-off months).
- Work log: describe what was done while clocked in (free text and/or projects managed by team leads); optional or required with a configurable share of the worked time; project report.
- Absence workflow (requests with a calendar showing holidays and existing absences, approvals, sick self-reports with documents), public-holiday calendars with import and Swiss presets, every employee sees the calendar that applies to them; vacation entitlement optionally pro-rated by scheduled days per week.
- Month sign-off with four enforcement levels (UI, services, SQLite triggers, HMAC seal chain) and an integrity check.
- Reports (timesheet, balances, absences, raw entries) as PDF, XLSX, CSV, localised in English, German and French.
- Roles: administrators without access to time data, HR and Projects capabilities, several leads per team, deputies with validity periods.
- Administration: setup wizard with one-time setup code, getting-started checklist, employees, teams, holidays, working-time rules, absence types, branding (logo and accent colour), backups, audit and sign-in logs.
- Security: Argon2id with breached-password check, two-factor authentication (TOTP with recovery codes; can be required for administrators or everyone), encrypted backups (Argon2id + ChaCha20-Poly1305, mandatory backup password), server-side sessions with absolute lifetime, `__Host-` cookies, CSRF, scoped and expiring API tokens, strict CSP without inline scripts, throttling per email+IP, hardened Docker Compose stack, hash-pinned dependencies.
- Data protection: per-person JSON export, anonymisation of former employees, attachment purge command.
- License: AGPL-3.0-or-later; a commercial license is available from RESORIX AG (mail@resorix.ch).
- REST API with OpenAPI documentation for desktop clients; per-user access tokens with scopes, expiry and a full audit trail (creation, use, revocation; administrator overview); apps obtain a token by signing in with password and two-factor code (`POST /auth/token`).
