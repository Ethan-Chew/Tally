# Self-hosting with Docker (what runs on piserv)

One container serves the API and the web app on port 3001. It talks to a shared Postgres container (`core-postgres`) and sits behind a reverse proxy.
The app has **no login**, so only expose it on a private network (e.g. Tailscale) or behind an authenticating proxy.

## Layout on the host
```
~/apps/maybe-lite/
  compose.yml      # see deploy/compose.pi.yml
  .env             # DATABASE_URL, PORT=3001, HOST=0.0.0.0, BACKUP_DIR=/backups, BACKUP_KEEP=30   (chmod 600)
  src/             # this repository (rsync'd), built into the image
```

## Run
The image is built by GitHub, not on the Pi (see "Updating"). Once it exists:
```bash
cd ~/apps/maybe-lite && docker compose pull && docker compose up -d
```
No port is published. The container joins the reverse proxy's Docker network, so the proxy reaches it at `http://maybe-lite:3001`.

## Database
Apps don't bring their own Postgres. One shared container, `core-postgres` (`deploy/core-postgres.yml`), serves them all on a Docker
network called `db`; each app gets its own database and a restricted login role that can only connect to that database.
```bash
mkdir -p ~/apps/core-postgres && cd ~/apps/core-postgres      # copy deploy/core-postgres.yml here as compose.yml
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env && chmod 600 .env
docker compose up -d
```
Add a database for an app (the password goes in on stdin, not on the command line):
```bash
docker exec -i core-postgres psql -U postgres <<SQL
CREATE ROLE maybe_lite LOGIN PASSWORD '<random>';
CREATE DATABASE maybe_lite OWNER maybe_lite TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.utf8' LC_CTYPE 'en_US.utf8';
REVOKE ALL ON DATABASE maybe_lite FROM PUBLIC;
GRANT CONNECT ON DATABASE maybe_lite TO maybe_lite;
SQL
```
Moving an existing database in (here: from the old Maybe Postgres) is a dump and restore with the app stopped, then compare row counts:
```bash
docker exec old-pg pg_dump -U <user> -d <db> -Fc > move.dump
docker exec -i core-postgres pg_restore -U postgres -d maybe_lite --no-owner --no-privileges --role=maybe_lite < move.dump
```
Then set `DATABASE_URL=postgres://maybe_lite:<password>@core-postgres:5432/maybe_lite` in the app's `.env`.
`pg_restore --role=maybe_lite --no-owner` makes the app's role own every table, so the app never needs superuser rights.

## Reverse proxy (nginx proxy manager)
Proxy host → scheme `http`, forward host `maybe-lite`, port `3001`, domain of your choice, request an SSL certificate.

## Backups
`docker exec maybe-lite bash scripts/db/backup.sh` writes a verified dump to the bind-mounted `/backups` (an external drive here).
Cron runs it daily; "Back up now" in Settings does the same. The bind mount is created with `create_host_path: false`, so if the drive
is unplugged the container refuses to start instead of silently filling the SD card.

## Updating
Develop locally, then `git push` to `main`. That's the whole deploy:

1. `.github/workflows/image.yml` builds the arm64 image and publishes it to `ghcr.io/<owner>/tally` (tags `latest` and the short commit sha).
2. On the Pi, cron runs `~/apps/maybe-lite/update.sh` every 5 minutes. When the `latest` image has changed it takes a database backup
   (tagged `pre-update`, never rotated), recreates the container, and waits for the health check. If the new version doesn't become
   healthy it puts the previous image back and won't retry that same image (it waits for the next push). Output goes to `~/maybe-lite-update.log`.

One-time setup on the Pi:
```bash
cp deploy/update.sh ~/apps/maybe-lite/update.sh && chmod +x ~/apps/maybe-lite/update.sh
docker login ghcr.io          # username = your GitHub user, password = a token with only the read:packages scope (private image)
( crontab -l; echo '*/5 * * * * $HOME/apps/maybe-lite/update.sh >> $HOME/maybe-lite-update.log 2>&1' ) | crontab -
```
Update right now instead of waiting: `~/apps/maybe-lite/update.sh`. Roll back by hand: `docker tag maybe-lite:previous ghcr.io/<owner>/tally:latest && docker compose up -d`.

I used a small cron script instead of Watchtower: Watchtower is archived upstream and needs the Docker socket (root on the host), and the script
adds the backup-before-update and the rollback.

## Rolling back
Before the original Maybe's Postgres was removed, a final copy was saved next to the backups (`original-maybe-postgres-final_<timestamp>/`:
custom-format dumps, a `pg_dumpall`, and the raw data directory as a tarball). To get the old database back, restore one of those dumps
into any Postgres 16 with `pg_restore`.
