#!/usr/bin/env bash
# Shared helpers for the db:* scripts. Source this, don't run it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

die()  { echo "✗ $*" >&2; exit 1; }
info() { echo "• $*"; }
ok()   { echo "✓ $*"; }

# Read KEY from the environment first, then from .env (without executing it).
env_get() {
  local key="$1" default="${2:-}" val="${!1:-}"
  if [ -z "$val" ] && [ -f "$ROOT/.env" ]; then
    val="$(grep -E "^${key}=" "$ROOT/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  fi
  echo "${val:-$default}"
}

# PostgreSQL client tools: prefer whatever is on PATH, then common install locations.
if ! command -v pg_dump >/dev/null 2>&1; then
  for d in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@15/bin \
           /opt/homebrew/bin /usr/local/opt/postgresql@17/bin /usr/local/opt/postgresql@16/bin /Applications/Postgres.app/Contents/Versions/latest/bin \
           /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin; do
    [ -x "$d/pg_dump" ] && PATH="$d:$PATH" && break
  done
fi
require_pg() {
  command -v pg_dump >/dev/null 2>&1 || die "PostgreSQL client tools not found. Install them first:  brew install postgresql@17"
}

DATABASE_URL="$(env_get DATABASE_URL)"
BACKUP_DIR="$(env_get BACKUP_DIR "$HOME/Documents/maybe-lite-backups")"
BACKUP_MIRROR_DIR="$(env_get BACKUP_MIRROR_DIR)"
BACKUP_KEEP="$(env_get BACKUP_KEEP 14)"
# .env values aren't shell-expanded, so handle a leading ~ ourselves
BACKUP_DIR="${BACKUP_DIR/#\~/$HOME}"; BACKUP_MIRROR_DIR="${BACKUP_MIRROR_DIR/#\~/$HOME}"

require_db() {
  [ -n "$DATABASE_URL" ] || die "DATABASE_URL isn't set. Run 'npm run db:local:init' for a local database, or put your own URL in .env"
  psql "$DATABASE_URL" -Atc "select 1" >/dev/null 2>&1 || die "Can't connect to $(redact "$DATABASE_URL"). Is the database running? (npm run db:local:start)"
}

# Hide the password when printing a connection string.
redact() { echo "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'; }

human_size() { # bytes -> 12.3 MB
  awk -v b="$1" 'BEGIN{ split("B KB MB GB",u," "); i=1; while (b>=1024 && i<4) { b/=1024; i++ } printf "%.1f %s", b, u[i] }'
}
# GNU/BusyBox `stat -c%s` first; macOS/BSD falls through to `stat -f%z` (on Linux `stat -f` means "filesystem", so it must not go first)
file_size() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }
