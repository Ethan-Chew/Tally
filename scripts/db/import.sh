#!/usr/bin/env bash
# Load a Maybe database dump (pg_dump custom format, or plain .sql) into the database in DATABASE_URL.
#   import.sh /path/to/maybe.dump [--force]
# If the target already has data you must pass --force; a safety backup (tagged "pre-import") is taken first.
source "$(dirname "$0")/common.sh"

FILE=""; FORCE=0
for a in "$@"; do case "$a" in --force|-f) FORCE=1 ;; -*) die "unknown option: $a" ;; *) FILE="$a" ;; esac; done
[ -n "$FILE" ] || die "usage: npm run db:import -- /path/to/maybe.dump [--force]"
[ -f "$FILE" ] || die "File not found: $FILE"
require_pg; require_db

# --- is this really a Maybe dump?
if [ "$(head -c5 "$FILE")" = "PGDMP" ]; then
  FORMAT=custom
  pg_restore -l "$FILE" >/dev/null 2>&1 || die "That file looks like a Postgres archive but can't be read (truncated or corrupt?)."
  pg_restore -l "$FILE" | grep -q "TABLE public accounts " || die "This dump has no 'accounts' table, so it doesn't look like a Maybe database."
else
  FORMAT=sql
  grep -qiE "CREATE TABLE public\.accounts" "$FILE" || die "This SQL file has no 'accounts' table, so it doesn't look like a Maybe database."
fi
info "Dump format: $FORMAT ($(human_size "$(file_size "$FILE")"))"

# --- protect existing data
EXISTING="$(psql "$DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$EXISTING" -gt 0 ]; then
  ROWS="$(psql "$DATABASE_URL" -Atc "select count(*) from accounts" 2>/dev/null || echo '?')"
  [ "$FORCE" -eq 1 ] || die "The target database already has $EXISTING tables ($ROWS accounts). Re-run with --force to REPLACE it (a safety backup is taken first)."
  info "Taking a safety backup before replacing the existing data …"
  bash "$(dirname "$0")/backup.sh" --tag pre-import | sed 's/^/    /' | grep -v '^    BACKUP_FILE='
  PGOPTIONS="-c client_min_messages=warning" psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null \
    || die "Couldn't clear the existing schema (insufficient privileges on a hosted database?). Import into an empty database instead."
fi

# --- restore
ERRLOG="$(mktemp)"; trap 'rm -f "$ERRLOG"' EXIT
info "Importing into $(redact "$DATABASE_URL") …"
if [ "$FORMAT" = custom ]; then
  # --no-owner/--no-privileges: the dump was made under Maybe's own role, which won't exist here.
  pg_restore --no-owner --no-privileges --dbname "$DATABASE_URL" "$FILE" 2>"$ERRLOG" || true
else
  psql "$DATABASE_URL" -q -f "$FILE" >/dev/null 2>"$ERRLOG" || true
fi
# Ignore harmless noise (comments on extensions need superuser on hosted databases); surface anything else.
REAL_ERRORS="$(grep -iE "error" "$ERRLOG" | grep -viE "extension|comment on" || true)"
[ -z "$REAL_ERRORS" ] || { echo "⚠ Some statements failed:" >&2; echo "$REAL_ERRORS" | head -8 >&2; }

# --- verify
psql "$DATABASE_URL" -Atc "select 1 from accounts limit 1" >/dev/null 2>&1 || die "Import finished but the 'accounts' table isn't usable. See messages above."
psql "$DATABASE_URL" -qc "ANALYZE" >/dev/null
echo
psql "$DATABASE_URL" -At -F '  ' -c "
  select 'accounts      ', count(*) from accounts union all
  select 'transactions  ', count(*) from account_transactions union all
  select 'entries       ', count(*) from account_entries union all
  select 'budgets       ', count(*) from budgets union all
  select 'categories    ', count(*) from categories" | sed 's/^/    /'
echo
ok "Import complete. Start the app with: npm run dev"
