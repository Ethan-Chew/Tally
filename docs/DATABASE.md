# Your data: where it lives, and how to keep it safe

Maybe Lite stores everything in **one PostgreSQL database** (the same tables the original Maybe app used).
The app itself keeps nothing on disk, so the database *is* your data. Back it up.

The connection is the `DATABASE_URL` line in `.env`. Settings → Data in the app shows where it points,
how big it is, and your latest backups.

## 1. Pick where the database runs

| Option | Best for | Setup |
|---|---|---|
| **Local, managed by this repo** (recommended) | One computer, no Docker | `brew install postgresql@17` then `npm run db:local:init` |
| **Docker** | You already use Docker | `docker compose up -d`, then `DATABASE_URL=postgres://maybe:maybe@localhost:5433/maybe` |
| **Hosted Postgres** | Reach your data from several devices, provider handles disks | Create a database at Neon, Supabase, Railway, Fly… and paste its URL (see below) |
| **Your own Postgres** | You run one already | Create an empty database and put its URL in `.env` |

### Local (managed) database
```bash
npm run db:local:init      # creates ~/.maybe-lite/postgres on localhost:5433, creates the "maybe" DB, writes .env
npm run db:local:start     # after a reboot
npm run db:local:stop
npm run db:local:status
```
Data lives in `~/.maybe-lite/postgres` (override with `MAYBE_PGDATA`, port with `MAYBE_PGPORT`). It only listens on localhost.

### Hosted database
Use the connection string the provider gives you and require TLS:
```
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```
Then `npm run db:import -- your.dump` as usual. A hosted *database* is fine; but note the **app itself has no login**,
so keep running the app on your own machine (it binds to `127.0.0.1`) rather than putting the app on the public internet.
If you do host the app, put it behind something that authenticates (a VPN, Tailscale, or an auth proxy).

## 2. Import your Maybe data
```bash
npm run db:import -- "/path/to/maybe_2026-10-31_1049.dump"
```
- Accepts a `pg_dump` custom-format file (what the original app's backup produced) or a plain `.sql` file.
- Refuses files that don't contain Maybe's `accounts` table.
- If the target already has data it stops, unless you add `--force`, in which case it first saves a **safety backup tagged `pre-import`**, then replaces everything.
- Prints row counts when done so you can see it worked.

## 3. Back up
```bash
npm run db:backup                       # → ~/Documents/maybe-lite-backups/maybe_YYYY-MM-DD_HHMMSS.dump
npm run db:backup -- --dir /Volumes/Drive/finance     # one-off to another folder
npm run db:backups                      # list backups
```
Every backup is **verified** (read back and checked for the `accounts` table); a failed one is discarded, never kept.

Settings (`.env`, all optional):
```
BACKUP_DIR=~/Documents/maybe-lite-backups     # where backups go
BACKUP_MIRROR_DIR=/Volumes/External/backups   # a 2nd copy after every backup (external drive, iCloud/Dropbox folder, NAS)
BACKUP_KEEP=14                                # keep the newest N regular backups in each folder
```
- If the mirror folder isn't available (drive unplugged) you get a warning; the main backup still succeeds.
- Rotation only deletes plain, dated backups. Anything tagged (`pre-import`, …) is kept until you delete it.
- You can also press **Back up now** in Settings → Data.

### Automatic daily backups
```bash
npm run db:backup:schedule -- install 02:30     # macOS launchd agent (Linux: prints a crontab line)
npm run db:backup:schedule -- status
npm run db:backup:schedule -- remove
```
Nothing is scheduled until you run `install`. Logs go to `~/.maybe-lite/backup.log`.

## 4. Restore
```bash
npm run db:restore -- maybe_2026-10-31_020000.dump     # a name from the backup folder, or a full path
```
You'll be asked to type `restore` to confirm (skip with `--yes`). Restoring replaces the current data and
takes a `pre-import` safety backup of it first, so even a mistaken restore is reversible.

## Moving to another database later
```bash
npm run db:backup                                        # on the old database
# change DATABASE_URL in .env to the new, empty database
npm run db:import -- ~/Documents/maybe-lite-backups/maybe_….dump
```

## Good practice
- Keep at least one backup **off this computer** (set `BACKUP_MIRROR_DIR` to a synced or external folder).
- Occasionally test a restore into a scratch database: `DATABASE_URL=postgres:///scratch npm run db:import -- file.dump`.
- Dumps contain your complete financial history. Treat the backup folders like the data itself.
