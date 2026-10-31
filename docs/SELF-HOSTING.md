# Self-hosting with Docker (what runs on piserv)

One container serves the API and the web app on port 3001. It talks to a Postgres container and sits behind a reverse proxy.
The app has **no login**, so only expose it on a private network (e.g. Tailscale) or behind an authenticating proxy.

## Layout on the host
```
~/apps/maybe-lite/
  compose.yml      # see deploy/compose.pi.yml
  .env             # DATABASE_URL, PORT=3001, HOST=0.0.0.0, BACKUP_DIR=/backups, BACKUP_KEEP=30   (chmod 600)
  src/             # this repository (rsync'd), built into the image
```

## Build and run
```bash
docker build -t maybe-lite:latest ~/apps/maybe-lite/src
cd ~/apps/maybe-lite && docker compose up -d
```
No port is published. The container joins the reverse proxy's Docker network, so the proxy reaches it at `http://maybe-lite:3001`.

## Database
Create a restricted role and a separate database inside the existing Postgres container, then copy the data across:
```bash
docker exec maybe-db-1 createdb -U maybe_user -O maybe_lite maybe_lite
docker exec maybe-db-1 pg_dump -U maybe_user -d maybe_production -Fc --no-owner --no-privileges \
  | docker exec -i maybe-db-1 pg_restore -U maybe_user -d maybe_lite --no-owner --no-privileges --role=maybe_lite
```
The original database is left untouched, so rolling back to the old app is just starting its containers again.

## Reverse proxy (nginx proxy manager)
Proxy host → scheme `http`, forward host `maybe-lite`, port `3001`, domain of your choice, request an SSL certificate.

## Backups
`docker exec maybe-lite bash scripts/db/backup.sh` writes a verified dump to the bind-mounted `/backups` (an external drive here).
Cron runs it daily; "Back up now" in Settings does the same. The bind mount is created with `create_host_path: false`, so if the drive
is unplugged the container refuses to start instead of silently filling the SD card.

## Updating
```bash
rsync -az --delete --exclude node_modules --exclude dist --exclude .git --exclude .env ./ host:apps/maybe-lite/src/
ssh host 'cd ~/apps/maybe-lite/src && docker build -t maybe-lite:latest . && cd .. && docker compose up -d'
```

## Rolling back to the old app
```bash
cd ~/apps/maybe-lite && docker compose down
cd ~/apps/maybe && docker compose start redis worker web
```
