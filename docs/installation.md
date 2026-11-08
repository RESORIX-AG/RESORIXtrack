# Installation

For the person who runs RESORIXtrack on a server.

## Requirements

- Linux server with **Docker 24+** and the Compose plugin (2.24+ for the proxy overlay). 1 vCPU, 1 GB RAM and a few GB of disk are enough for 50 people.
- A DNS name, e.g. `time.example.com`.
- An SMTP account (invitations, password resets, notifications).
- Ports 80 and 443 open if you use the built-in Caddy.
- Internal network or VPN only, see [security.md](security.md).

## 1. Configure

```bash
git clone https://github.com/RESORIX-AG/RESORIXtrack.git resorixtrack
cd resorixtrack
cp .env.example .env
chmod 600 .env
openssl rand -base64 48   # SECRET_KEY
openssl rand -base64 48   # SIGNOFF_KEY (recommended)
```

Set at least `SECRET_KEY`, `BACKUP_PASSWORD`, `BASE_URL`, `RESORIXTRACK_DOMAIN` (with Caddy), `SMTP_*` and `TRUSTED_PROXIES`. Store `SECRET_KEY`, `SIGNOFF_KEY` and `BACKUP_PASSWORD` in your password manager. All variables: [reference](#environment-reference).

## 2. Start

Pick one:

| Setup | Command | Notes |
|---|---|---|
| Built-in HTTPS (recommended) | `docker compose --profile tls up -d --build` | Caddy gets a Let's Encrypt certificate for `RESORIXTRACK_DOMAIN`. `TRUSTED_PROXIES=1`. |
| Own reverse proxy on the host | `docker compose up -d --build` | App on `127.0.0.1:8080`. See below. |
| Own reverse proxy on a Docker network | `docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build` | No host port. See below. |

The stack has three services: `app` (web), `worker` (background jobs) and, with the `tls` profile, `caddy`.

### Own reverse proxy

Forward `https://time.example.com` to `http://127.0.0.1:8080`, send `X-Forwarded-For` and `X-Forwarded-Proto`, allow request bodies of 12 MB, terminate TLS at the proxy, and set `TRUSTED_PROXIES` to the number of proxies in front of the app (usually `1`).

### Proxy on a shared Docker network

For Nginx Proxy Manager, Traefik or a Caddy in another stack:

1. Find the proxy's network: `docker network ls`.
2. In `.env`: `PROXY_NETWORK=<network>`, `TRUSTED_PROXIES=1`, `BASE_URL=https://time.example.com`, optionally `PORT=<port of your proxy entry>` (default `8080`).
3. Start with both compose files (table above).
4. Point the proxy at `http://resorixtrack:<PORT>`.

## 3. First-run setup

1. Get the one-time setup code from the log: `docker compose logs app | grep -A4 "first-run setup"`. Every start prints a fresh one while setup is open; `docker compose exec app rt setup-code` makes a new one any time.
2. Open `BASE_URL`. The wizard asks for company, working time, public-holiday calendar and your administrator account, plus the setup code.
3. The first administrator also gets the HR and Projects capabilities; hand them to others later.
4. Continue with the [administrator guide](admin-guide.md).

Instead of the wizard you can create an administrator from the shell; this also marks setup as complete:

```bash
docker compose exec app rt create-admin --email admin@example.com --name "Ada Admin" --password '<password>'
```

## Email (SMTP)

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURITY` | Notes |
|---|---|---|---|---|
| Microsoft 365 | `smtp.office365.com` | 587 | `starttls` | SMTP AUTH enabled for the mailbox |
| Google Workspace | `smtp.gmail.com` | 587 | `starttls` | app password |
| Infomaniak | `mail.infomaniak.com` | 587 | `starttls` | |
| Implicit TLS | your host | 465 | `ssl` | |
| Local relay | your relay | 25 | `none` | leave `SMTP_USER` empty |

Test under **Administration → Settings → Email → Send test email**. Without SMTP, administrators set passwords directly (Employees → Access → Set password).

## Single sign-on (OpenID Connect)

Optional, any OIDC provider (e.g. Pocket ID).

1. At the provider, create a client with redirect URI `<BASE_URL>/api/auth/callback/oidc`.
2. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (and `OIDC_NAME` for the button label).
3. Restart: `docker compose up -d`.

A sign-in succeeds only for an existing active person with the same email (verified by the provider unless `OIDC_REQUIRE_VERIFIED_EMAIL=false`); nobody is created. With `OIDC_ONLY=true` password sign-in is off; break-glass: `docker compose exec app rt reset-password --email <email>` asks for a password and allows one password sign-in.

## Updates

```bash
git pull
docker compose --profile tls up -d --build   # without --profile tls for your own proxy
```

On start the app runs `rt migrate`: with pending migrations it first writes an encrypted backup labelled `premigrate`, then applies all of them in order, so skipping releases is fine. `rt migrate --check` exits 1 while migrations are pending and changes nothing. Release notes: [CHANGELOG.md](../CHANGELOG.md).

The app refuses, without touching the file:

- a database already upgraded by a newer version: downgrades are not supported; install the newer version or restore a backup made with this one.

## Health and worker

| Check | How |
|---|---|
| Containers | `docker compose ps` (app and worker `healthy`) |
| App | `curl -s https://time.example.com/api/health` returns `{"status":"ok","workerAgeSeconds":…}` |
| Worker | heartbeat every 60 s; its health check runs `rt worker-alive` |
| Logs | `docker compose logs -f app worker` |

Worker jobs (company timezone):

| Job | When |
|---|---|
| Encrypted backup, rotation (`BACKUP_KEEP`) | daily 02:00 |
| Clock-out reminders | every 5 minutes |
| Cleanup: sign-in log, read notifications, expired sessions, tokens, API keys | daily 03:30 |
| Integrity check of sign-off seals and database guards (notifies HR and admins on problems) | Sunday 04:00 |

## Data

Everything is in the volume `resorixtrack-data` (`/data`): database, documents, logos, backups. Set up off-site copies right away: [backup-restore.md](backup-restore.md).

## CLI

Run inside the container: `docker compose exec app rt <command>`. `rt help` lists all.

| Command | Purpose |
|---|---|
| `setup-code` | Fresh one-time code for the setup wizard |
| `migrate [--check] [--no-backup]` | Back up, then apply pending migrations (runs on start); `--check` exits 1 when pending |
| `create-admin --email --name --password` | Create an administrator |
| `reset-password --email [--password]` | Set a password (asked when left out), end all sessions and API keys (break-glass with `OIDC_ONLY`) |
| `backup [--label x] [--no-attachments]` | Encrypted backup now |
| `restore <file> [--yes] [--ask-password]` | Restore a backup (app stopped), see [backup-restore.md](backup-restore.md) |
| `decrypt-backup <file> --out <dir> [--ask-password]` | Decrypt a backup into an empty directory without restoring it |
| `anonymize --email <email> [--yes]` | Anonymise a former employee once the retention period is over |
| `install-holidays --preset <key> [--days "Easter Monday,Whit Monday"] [--years 2026,2027] [--default]` | Public holidays from a canton preset (`CH-ZH` …); `--days` ticks optional days (default: the canton's commune days) |
| `install-holidays --top-up` | Add the missing years to all preset calendars (the worker does it every 1 October) |
| `send-reminders` | Send clock-out reminders now |
| `verify-signoffs` | Check every sign-off seal chain; exit 1 on problems |
| `worker-alive` | Worker health check |

## Environment reference

Secrets can be read from files by appending `_FILE` (`SECRET_KEY_FILE`, `SIGNOFF_KEY_FILE`, `BACKUP_PASSWORD_FILE`, `SMTP_PASSWORD_FILE`, `OIDC_CLIENT_SECRET_FILE`), e.g. for Docker secrets. Defaults are the production defaults.

**Required**

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | none | 32+ random characters. Derives the session and two-factor keys and, without `SIGNOFF_KEY`, the seal key. The app refuses the placeholder or a weak key. |
| `BACKUP_PASSWORD` | none | 12+ characters. Encrypts every backup. Without it no backup can be restored. |
| `BASE_URL` | `http://localhost:8080` | Public URL; used in emails, cookies, passkeys and OIDC. |

**Security and sessions**

| Variable | Default | Description |
|---|---|---|
| `SIGNOFF_KEY` | `SECRET_KEY` | Key for sign-off seals. Keep it apart from backups. |
| `TRUSTED_PROXIES` | `0` | Proxies in front of the app. Forwarded headers are trusted only when `>= 1`; with `0` the TCP peer is the client. |
| `SESSION_COOKIE_SECURE` | `true` | Cookies over HTTPS only. `false` only for a plain-HTTP test. |
| `SESSION_REMEMBER_DAYS` | `30` | Session lifetime with "Keep me signed in" (extended while in use). |
| `SESSION_SHORT_IDLE_HOURS` | `12` | Idle timeout without "Keep me signed in". |
| `SESSION_ABSOLUTE_DAYS` | `90` | Hard cap for any session, however active. |
| `LOGIN_MAX_FAILURES` | `8` | Failed sign-ins per email and IP in the window. |
| `LOGIN_WINDOW_MINUTES` | `15` | Throttling window. |
| `SETUP_CODE_REQUIRED` | `true` | Require the setup code in the wizard. |
| `PWNED_PASSWORDS_CHECK` | `true` | Check new passwords against Have I Been Pwned (5-character hash prefix only; fails open). |

**Email**

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | empty | Mail server; empty disables email. |
| `SMTP_PORT` | `587` | Port. |
| `SMTP_SECURITY` | `starttls` | `starttls`, `ssl` or `none`. |
| `SMTP_USER`, `SMTP_PASSWORD` | empty | Credentials. |
| `SMTP_ALLOW_PLAINTEXT_AUTH` | `false` | Allow a password over `none`. |
| `SMTP_TIMEOUT` | `20` | Seconds. |
| `MAIL_FROM` | `RESORIXtrack <resorixtrack@localhost>` | Sender. |

**Single sign-on**

| Variable | Default | Description |
|---|---|---|
| `OIDC_ISSUER` | empty | Issuer URL; OIDC is on when issuer and client id are set. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | empty | Client credentials. |
| `OIDC_NAME` | `Pocket ID` | Button label. |
| `OIDC_SCOPES` | `openid email profile` | Requested scopes. |
| `OIDC_ONLY` | `false` | Disable password sign-in. |
| `OIDC_REQUIRE_VERIFIED_EMAIL` | `true` | Match only verified emails. |

**Application**

| Variable | Default | Description |
|---|---|---|
| `ATTACHMENT_MAX_MB` | `10` | Max document upload. |
| `BACKUP_KEEP` | `14` | Nightly backups kept. |
| `SOURCE_URL` | upstream repository | "Source code" link on the sign-in page; point it to your fork if you modified RESORIXtrack (AGPL section 13). |
| `RESORIXTRACK_DATA_DIR` | `/data` | Data directory (database, attachments, branding, backups). |
| `DATABASE_PATH` | `<data dir>/resorixtrack.db` | Database file. |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Listen address inside the container. |

**Docker Compose**

| Variable | Default | Description |
|---|---|---|
| `RESORIXTRACK_DOMAIN` | `localhost` | Domain for Caddy (`--profile tls`). |
| `RESORIXTRACK_BIND`, `RESORIXTRACK_PORT` | `127.0.0.1`, `8080` | Published app port on the host. |
| `PROXY_NETWORK` | `proxy` | Network of your proxy (proxy overlay). |
| `RESORIXTRACK_IMAGE` | `resorixtrack:latest` | Image to run. |
| `RESORIXTRACK_ENV_FILE` | `.env` | Env file (e.g. for a test stack). |
| `RESORIXTRACK_MEM_LIMIT`, `RESORIXTRACK_WORKER_MEM_LIMIT` | `1g`, `512m` | Memory limits. |

Business rules (working time, holidays, absence types, two-factor policy, retention) are set in the web UI under **Administration → Settings**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Signed out immediately, actions fail | Plain HTTP with `SESSION_COOKIE_SECURE=true`. Use HTTPS. |
| "The setup code is missing or wrong" | `docker compose exec app rt setup-code` and use the new code. |
| Wrong IP in the sign-in log, everyone throttled together | Set `TRUSTED_PROXIES` to the number of proxies. |
| No emails | *Send test email* in Settings shows the SMTP error; `docker compose logs app`. |
| Uploads fail with 413 | Raise the proxy body limit to 12 MB. |
| Passkeys or OIDC fail | `BASE_URL` must match the URL in the browser exactly. |
| App refuses to start | The log names the missing or weak secret. |
