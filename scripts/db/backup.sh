#!/usr/bin/env bash
# Back up the database to a dated file. Safe to run any time, including while the app is running.
#   backup.sh [--dir FOLDER] [--mirror FOLDER] [--keep N] [--tag LABEL]
# Defaults come from .env: BACKUP_DIR (~/Documents/maybe-lite-backups), BACKUP_MIRROR_DIR (optional 2nd copy), BACKUP_KEEP (14).
# Files tagged with --tag (e.g. "pre-import") are never deleted by rotation.
source "$(dirname "$0")/common.sh"
require_pg; require_db

TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) BACKUP_DIR="$2"; shift 2 ;;
    --mirror) BACKUP_MIRROR_DIR="$2"; shift 2 ;;
    --keep) BACKUP_KEEP="$2"; shift 2 ;;
    --tag) TAG="_$2"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR" 2>/dev/null || true
STAMP="$(date +%Y-%m-%d_%H%M%S)"
FILE="$BACKUP_DIR/maybe_${STAMP}${TAG}.dump"
TMP="$FILE.partial"

info "Backing up $(redact "$DATABASE_URL") …"
# Custom format: compressed, and restorable with pg_restore (selectively if you like).
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$TMP" || { rm -f "$TMP"; die "pg_dump failed"; }

# A backup you haven't checked isn't a backup: make sure it can be read and contains the real tables.
pg_restore -l "$TMP" | grep -q "TABLE public accounts " || { rm -f "$TMP"; die "Backup verification failed (no accounts table in the dump). Nothing was kept."; }
mv "$TMP" "$FILE"; chmod 600 "$FILE"
ok "Saved $FILE ($(human_size "$(file_size "$FILE")"))"

# Optional second copy elsewhere (external drive, iCloud/Dropbox folder, NAS...). A missing drive is a warning, not a failure.
if [ -n "$BACKUP_MIRROR_DIR" ]; then
  if mkdir -p "$BACKUP_MIRROR_DIR" 2>/dev/null && cp "$FILE" "$BACKUP_MIRROR_DIR/"; then ok "Mirrored to $BACKUP_MIRROR_DIR"; else echo "⚠ Couldn't copy to $BACKUP_MIRROR_DIR (drive not connected?)" >&2; fi
fi

# Rotation: keep the newest N untagged backups in each folder.
rotate() {
  local dir="$1" n="$2" count=0
  [ -d "$dir" ] || return 0
  # untagged = maybe_YYYY-MM-DD_HHMMSS.dump exactly
  for f in $(ls -1t "$dir"/maybe_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9].dump 2>/dev/null); do
    count=$((count + 1)); [ "$count" -gt "$n" ] && { rm -f "$f"; info "Removed old backup $(basename "$f")"; }
  done
  return 0
}
if [ "$BACKUP_KEEP" -gt 0 ] 2>/dev/null; then rotate "$BACKUP_DIR" "$BACKUP_KEEP"; [ -n "$BACKUP_MIRROR_DIR" ] && rotate "$BACKUP_MIRROR_DIR" "$BACKUP_KEEP"; fi
echo "BACKUP_FILE=$FILE"
