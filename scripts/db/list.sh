#!/usr/bin/env bash
# List backups (newest first) in the backup folder and the mirror folder.
source "$(dirname "$0")/common.sh"
show() {
  local dir="$1" label="$2"
  [ -n "$dir" ] && [ -d "$dir" ] || { [ -n "$dir" ] && info "$label: $dir (not found)"; return 0; }
  echo "$label: $dir"
  local any=0
  for f in $(ls -1t "$dir"/maybe_*.dump 2>/dev/null); do
    any=1; printf "  %-48s %10s   %s\n" "$(basename "$f")" "$(human_size "$(file_size "$f")")" "$(date -r "$f" '+%Y-%m-%d %H:%M' 2>/dev/null || stat -c %y "$f" | cut -c1-16)"
  done
  [ "$any" -eq 1 ] || echo "  (no backups yet — run: npm run db:backup)"
}
show "$BACKUP_DIR" "Backups"
show "$BACKUP_MIRROR_DIR" "Mirror "
