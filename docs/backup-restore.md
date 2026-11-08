# Backup and restore

All data lives in the Docker volume `resorixtrack-data`, mounted at `/data`:

```
/data/resorixtrack.db   SQLite database (WAL)
/data/attachments/      documents (sick notes), random file names
/data/branding/         uploaded logos
/data/backups/          encrypted backups
```

`.env` lives outside the volume. Keep `BACKUP_PASSWORD`, `SECRET_KEY` and `SIGNOFF_KEY` in your password manager: without `BACKUP_PASSWORD` no backup can be opened; without the original `SIGNOFF_KEY` restored sign-offs show "seal invalid" (the data is intact).

## What a backup is

`resorixtrack-YYYYMMDD-HHMMSS[-label].zip.enc`: an encrypted ZIP with

- `resorixtrack.db`: a consistent snapshot, safe while people work,
- `attachments/`: current documents (optional),
- `branding/`: logos,
- `manifest.json`: version, time, SHA-256 of every file (checked on restore).

**Encryption** (format RTBK1): a key derived from `BACKUP_PASSWORD` with Argon2id (64 MiB, 3 passes, random salt per archive), ChaCha20-Poly1305 in 1 MiB chunks, header authenticated in every chunk, truncation detected. The ZIP is streamed into the encryptor; no unencrypted archive touches the disk. Changing `BACKUP_PASSWORD` affects new backups only; restore older ones with `--ask-password`. Format details: `src/server/services/backup-crypto.ts`.

## When backups are made

| Trigger | Notes |
|---|---|
| Nightly 02:00 (worker) | `-auto`, with documents; the last `BACKUP_KEEP` (14) are kept |
| Administration → Backups & logs → Create backup | With documents; download from the list |
| `docker compose exec app rt backup [--label x] [--no-attachments]` | Manual |
| Update with pending migrations (`rt migrate` on start) | `-premigrate`, without documents (migrations do not touch them) |

Only `-auto` backups are rotated. Delete others in the web UI.

## Off-site copies

A backup on the same disk does not survive disk failure, ransomware or a lost server. Copy at least daily, for example:

```bash
# from another machine, via SSH
0 3 * * * ssh rt-host 'cd /srv/resorixtrack && docker compose exec -T app sh -c "ls -t /data/backups/*-auto.zip.enc | head -1 | xargs cat"' > /backups/resorixtrack-$(date +\%F).zip.enc

# or on the host, into a folder your backup tool (restic, borg, rclone) syncs
docker run --rm -v resorixtrack_resorixtrack-data:/data:ro -v /srv/offsite:/out alpine sh -c 'cp /data/backups/*-auto.zip.enc /out/'
```

The archives are encrypted, so any destination works, as long as the password is stored elsewhere. The volume name is `<project>_resorixtrack-data` (`docker volume ls`).

## Restore

Replaces the database, documents and logos (the documents only if the backup includes them). The current data is set aside while the restore runs and put back if it fails; after a successful restore it is deleted, together with copies an earlier release left as `*.before-restore-<time>`. To keep the current state, make a backup first.

1. Stop the app and worker:
   ```bash
   docker compose stop app worker
   ```
2. Restore (a file in `/data/backups`, or mount one with `-v /path/to/file.zip.enc:/restore.zip.enc:ro`):
   ```bash
   docker compose run --rm --no-deps app rt restore /data/backups/<file>.zip.enc
   ```
   It prints the backup's date and version and asks before replacing. `--yes` skips the question; `--ask-password` asks for an older backup password.
3. Start:
   ```bash
   docker compose up -d
   ```
   Pending migrations run on start, so a backup from an older 2.x release restores fine. Restore into the same or a newer release.
4. Check:
   - sign in; Administration → Backups & logs shows the expected audit log;
   - `docker compose exec app rt verify-signoffs` reports all sign-offs intact;
   - tell people to re-enter anything recorded after the backup time.

A RESORIXtrack 1.x backup is refused.

## Decrypt without restoring

To look inside a backup without replacing anything:

```bash
docker compose exec app rt decrypt-backup /data/backups/<file>.zip.enc --out /tmp/inspect
```

It writes the files into the empty directory `--out` and nowhere else, and checks the checksums. Delete the directory afterwards: it holds decrypted personal data.

Disaster recovery without RESORIXtrack: `scripts/decrypt-backup.mjs` needs only Node.js and `@node-rs/argon2` and writes the plain ZIP:

```bash
npm install @node-rs/argon2
BACKUP_PASSWORD=... node decrypt-backup.mjs <file>.zip.enc backup.zip
```

## Moving to another server

1. Old server: `rt backup`, copy the archive and `.env`.
2. New server: install as in [installation.md](installation.md) with the **same `.env`** (at least `SECRET_KEY`, `SIGNOFF_KEY`, `BACKUP_PASSWORD`), restore as above.
3. Switch DNS.

## Test your restore

Once a quarter, into a throwaway stack:

```bash
cp .env .env.test   # keep BACKUP_PASSWORD; set SESSION_COOKIE_SECURE=false, TRUSTED_PROXIES=0, BASE_URL=http://localhost:18080
export RESORIXTRACK_ENV_FILE=.env.test RESORIXTRACK_PORT=18080
docker compose -p rt-test run --rm --no-deps -v "$PWD/backups/<file>.zip.enc:/restore.zip.enc:ro" app rt restore /restore.zip.enc --yes
docker compose -p rt-test up -d app
# open http://localhost:18080, check, then:
docker compose -p rt-test down -v
```

## Personal data in backups

Backups contain everything as of their date, including data later anonymised. Apply your retention rules to off-site copies too. Removed documents are not included.
