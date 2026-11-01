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

## First-time setup on the Pi
The image is built by GitHub, not on the Pi (see "Updating"), so the Pi only needs the compose file, a `.env`, and permission to pull the image.

1. Put `deploy/compose.pi.yml` at `~/apps/maybe-lite/compose.yml` and `deploy/update.sh` next to it (`chmod +x update.sh`). Create `.env` (see "Layout on the host"), `chmod 600`.
2. Let the Pi pull the image. A private repository publishes a private package. Either make the package public (GitHub, your profile, Packages, `tally`, Package settings, Change visibility), or log in once on the Pi with a token that has only the `read:packages` scope:
   ```bash
   docker login ghcr.io        # username = your GitHub user, password = the token
   ```
3. Start it:
   ```bash
   cd ~/apps/maybe-lite && docker compose pull && docker compose up -d
   docker ps --filter name=maybe-lite       # STATUS should say (healthy) after a few seconds
   ```
4. Turn on automatic updates (see "Updating"):
   ```bash
   ( crontab -l 2>/dev/null; echo '*/5 * * * * $HOME/apps/maybe-lite/update.sh >> $HOME/maybe-lite-update.log 2>&1' ) | crontab -
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
Develop locally, then `git push` to `main`. That's the whole deploy.

**When CI runs.** `.github/workflows/image.yml` runs on every push to `main` and when you press *Run workflow* on the Actions tab (`workflow_dispatch`). It does not run on other branches or pull requests. If you push twice in a row, the older run is cancelled. A build takes a few minutes (arm64 is emulated; later builds reuse a cache). It publishes `ghcr.io/<owner>/tally` with two tags: `latest` and the short commit sha.

**What the Pi does.** Cron runs `~/apps/maybe-lite/update.sh` every 5 minutes:
1. It pulls `latest`. If nothing changed it exits quietly.
2. If the image changed, it takes a database backup tagged `pre-update` (never rotated away), keeps the old image as `maybe-lite:previous`, and recreates the container.
3. It waits up to a minute for the health check. If the new version doesn't become healthy, it puts the previous image back and won't retry that same image until a newer one is pushed.

So after a push, expect the new version on the Pi within roughly the build time plus 5 minutes.

**Day-to-day commands (on the Pi)**
```bash
~/apps/maybe-lite/update.sh                    # update right now instead of waiting for cron
tail -n 30 ~/maybe-lite-update.log             # what the last runs did (empty when nothing changed)
docker ps --filter name=maybe-lite             # running image and health
docker logs --tail 50 maybe-lite               # the app's own log
docker tag maybe-lite:previous ghcr.io/<owner>/tally:latest && cd ~/apps/maybe-lite && docker compose up -d   # roll back by hand
```
To go back to a specific build, pin the sha tag in `compose.yml` (`image: ghcr.io/<owner>/tally:<sha>`) and run `docker compose up -d`; remove the pin to follow `latest` again.

**If an update doesn't arrive**
- Check the Actions run on GitHub went green (red means no new image was published).
- Run `update.sh` by hand and read its output. `unauthorized` or `denied` means the Pi's `docker login ghcr.io` is missing or expired, or the package is private.
- `crontab -l` should show the `update.sh` line; `command -v flock` must exist (install `util-linux` if not).
- A line saying the new version is NOT healthy means it was rolled back; read `docker logs maybe-lite` for why, fix, and push again.

I used a small cron script instead of Watchtower: Watchtower is archived upstream and needs the Docker socket (root on the host), and the script
adds the backup-before-update and the rollback.

## Rolling back
Before the original Maybe's Postgres was removed, a final copy was saved next to the backups (`original-maybe-postgres-final_<timestamp>/`:
custom-format dumps, a `pg_dumpall`, and the raw data directory as a tarball). To get the old database back, restore one of those dumps
into any Postgres 16 with `pg_restore`.
