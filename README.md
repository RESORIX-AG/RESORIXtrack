<p align="center"><img src="public/brand/resorix-logo-on-light.svg" alt="RESORIX AG" height="56"></p>

# RESORIXtrack

Self-hosted time tracking for small and mid-sized companies: clocking, time and vacation accounts, absences with approvals, monthly sign-off, reports and a complete change history. Labour-law rules are built in per country, Switzerland first (breaks, daily rest, night and Sunday work, retention); further countries can be added as rule sets. Developed by [RESORIX AG](https://resorix.ch), free software under AGPL-3.0 (commercial license available), for companies that keep employee data on their own server.

<p align="center"><img src="docs/screenshots/employee-dark-home.png" alt="Dashboard" width="860"></p>

> **Intended use and disclaimer.** RESORIXtrack is built for **internal hosting on a company network or behind a VPN**. It is not hardened for exposure to the public internet and must not be published there. You deploy and run it **at your own risk**; RESORIX AG accepts no responsibility or liability for any damage, data loss or other consequences arising from the use of this software. See [SECURITY.md](SECURITY.md) and [docs/security.md](docs/security.md).

## Features

**Employees**
- Clock in and out from every page, at a custom time or scheduled for later; a break is simply a clock-out; keyboard shortcut; works offline and syncs later.
- Time account (target from the work schedule, worked, balance) and vacation account (entitlement, carry-over, half days).
- Absence requests with a calendar of holidays and existing absences; sick report in one click with optional doctor's note.
- Public holidays page: the calendar that applies to you (personal, team or company default), read-only.
- Projects on time entries: each entry says which project its time was spent on; switch projects on the clock without a break; optional or required per company.
- Own edits are allowed and logged; corrections by others are marked and can be disputed.

**Team leads and HR**
- Team overview, approvals, corrections with a reason, team projects, deputies with a validity period.
- Month sign-off: the month becomes read-only for everyone, sealed with an HMAC chain.

**Swiss law** ([docs/compliance.md](docs/compliance.md))
- Checks breaks, daily rest, day span, night and Sunday work, weekly maximum, Überzeit per day and year, consecutive days, minimum vacation (ArG, ArGV 1, OR).
- Full, simplified (Art. 73b) or waived (Art. 73a) recording per person; records kept at least 5 years; labour-law report for the inspectorate.
- revDSG: personal data export, anonymisation after the retention period, privacy notice page, [record of processing template](docs/privacy.md).

**Administration**
- Setup wizard, employees, teams, work schedules, public-holiday calendars (Swiss cantons built in, import for other regions), absence types, branding.
- Reports: timesheet, balances, absences, projects, time entries, labour law; as PDF, XLSX, CSV.
- Administrators see no working times; the HR capability is granted explicitly.

**Security**
- Argon2id passwords with breached-password check, TOTP two-factor, passkeys, single sign-on via OpenID Connect (e.g. Pocket ID).
- Server-side sessions, CSRF protection, strict CSP with nonces, rate limiting, sign-in log, audit log.
- Encrypted backups (Argon2id + ChaCha20-Poly1305), nightly and on demand.
- REST API (`/api/v1`, OpenAPI) with scoped, expiring API keys.

**Languages:** English, German, French, Italian (more via JSON files).

**Stack:** TanStack Start (React 19, SSR), Drizzle + SQLite, Better Auth, shadcn/ui on Base UI, Node 26, Docker Compose with optional Caddy for HTTPS.

## Quick start

Requirements: Linux server with Docker 24+ and the Compose plugin, a DNS name, an SMTP account.

```bash
git clone https://github.com/RESORIX-AG/RESORIXtrack.git resorixtrack
cd resorixtrack
cp .env.example .env
openssl rand -base64 48        # paste as SECRET_KEY
# edit .env: SECRET_KEY, BACKUP_PASSWORD, BASE_URL, RESORIXTRACK_DOMAIN, SMTP_*
docker compose --profile tls up -d --build
docker compose exec app rt setup-code
```

Open `https://<your-domain>`, enter the setup code and follow the wizard.

## Documentation

| Guide | For |
|---|---|
| [Installation](docs/installation.md) | Docker, HTTPS, configuration, updates |
| [Administrator guide](docs/admin-guide.md) | Setting up the company, administration pages |
| [User manual](docs/user-manual.md) | Employees and team leads |
| [Security](docs/security.md) | Protection model, operator checklist |
| [Swiss law](docs/compliance.md) | What is checked and kept |
| [Privacy](docs/privacy.md) | Record of processing template (revDSG) |
| [Backup and restore](docs/backup-restore.md) | Encrypted backups, restore, off-site copies |
| [Customizing](docs/customizing.md) | Branding, theme tokens, languages |
| [API](docs/api.md) | API keys, scopes, errors |
| [Development](docs/development.md) | Local setup, tests, migrations, releases |
| [Architecture](docs/architecture.md), [Design](docs/design.md) | Contributors |
| [Licensing](LICENSING.md), [Third-party licenses](docs/third-party-licenses.md) | AGPL, commercial license, dependencies |
| [Changelog](CHANGELOG.md) | Release notes |

## Development in one minute

```bash
pnpm install
pnpm cli seed-demo --reset   # demo company, password "demo"
pnpm dev                     # http://localhost:3210
pnpm test
```

Details: [docs/development.md](docs/development.md).

## Support

Bug reports and feature requests as GitHub issues. Security issues: [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-or-later](LICENSE) © RESORIX AG. Commercial license: mail@resorix.ch, see [LICENSING.md](LICENSING.md).
