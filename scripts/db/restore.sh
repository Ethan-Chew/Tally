#!/usr/bin/env bash
# Restore one of your backups over the current database (takes a "pre-import" safety backup first).
#   restore.sh /path/to/maybe_2026-10-31_020000.dump [--yes]
source "$(dirname "$0")/common.sh"
FILE=""; YES=0
for a in "$@"; do case "$a" in --yes|-y) YES=1 ;; -*) die "unknown option: $a" ;; *) FILE="$a" ;; esac; done
[ -n "$FILE" ] || { echo "Available backups:"; bash "$(dirname "$0")/list.sh"; die "usage: npm run db:restore -- <file>"; }
[ -f "$FILE" ] || { [ -f "$BACKUP_DIR/$FILE" ] && FILE="$BACKUP_DIR/$FILE"; }
[ -f "$FILE" ] || die "Backup not found: $FILE"
if [ "$YES" -ne 1 ]; then
  echo "This REPLACES everything in $(redact "$DATABASE_URL") with $(basename "$FILE")."
  read -r -p "Type 'restore' to continue: " ans; [ "$ans" = "restore" ] || die "Cancelled."
fi
exec bash "$(dirname "$0")/import.sh" "$FILE" --force
