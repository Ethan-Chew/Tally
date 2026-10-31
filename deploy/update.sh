#!/usr/bin/env bash
# Run on the host (cron, every few minutes) from the folder that holds compose.yml:
# pull the latest image and, only if it changed, back up the database, recreate the container and check it comes up healthy.
# If the new version never becomes healthy the previous image is put back. Silent when there is nothing to do.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
exec 9> "${TMPDIR:-/tmp}/maybe-lite-update.lock"
flock -n 9 || exit 0   # a previous run is still going

SERVICE=app
CONTAINER=maybe-lite
IMAGE=$(docker compose config --images | head -n1)
BEFORE=$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)

docker compose pull --quiet "$SERVICE"
AFTER=$(docker image inspect "$IMAGE" --format '{{.Id}}')
[ "$BEFORE" = "$AFTER" ] && exit 0

# A release that already failed its health check is not retried every run: wait for a newer one.
BAD_FILE=.bad-image
if [ -f "$BAD_FILE" ] && [ "$AFTER" = "$(cat "$BAD_FILE")" ]; then
  docker tag "$CONTAINER:previous" "$IMAGE"   # the pull moved the tag; point it back at what is running
  exit 0
fi

echo "$(date -Is) new image ${AFTER#sha256:} (was ${BEFORE#sha256:})"
OLD_PREVIOUS=$(docker image inspect "$CONTAINER:previous" --format '{{.Id}}' 2>/dev/null || true)
[ -n "$BEFORE" ] && docker tag "$BEFORE" "$CONTAINER:previous"

# A tagged backup is never rotated away, so there is always a copy from just before the update.
docker exec "$CONTAINER" bash scripts/db/backup.sh --tag pre-update || echo "warning: pre-update backup failed" >&2

docker compose up -d "$SERVICE"
for _ in $(seq 1 30); do
  [ "$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
  sleep 2
done

if [ "$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ]; then
  echo "$(date -Is) updated and healthy"
  rm -f "$BAD_FILE"
  # the image before last is no longer needed
  [ -n "$OLD_PREVIOUS" ] && [ "$OLD_PREVIOUS" != "$BEFORE" ] && docker rmi "$OLD_PREVIOUS" >/dev/null 2>&1 || true
else
  echo "$(date -Is) new version is NOT healthy, rolling back" >&2
  docker logs --tail 30 "$CONTAINER" >&2 || true
  echo "$AFTER" > "$BAD_FILE"
  [ -n "$BEFORE" ] && docker tag "$CONTAINER:previous" "$IMAGE" && docker compose up -d "$SERVICE"
  exit 1
fi
