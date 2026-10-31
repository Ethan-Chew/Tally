#!/usr/bin/env bash
# A private, persistent PostgreSQL just for this app (separate from any system Postgres).
#   local-db.sh init | start | stop | status | psql | path
# Data lives in ~/.maybe-lite/postgres by default and listens on localhost only.
source "$(dirname "$0")/common.sh"
require_pg
command -v initdb >/dev/null 2>&1 || die "initdb not found. brew install postgresql@17"

PGDATA_DIR="${MAYBE_PGDATA:-$HOME/.maybe-lite/postgres}"
PGPORT_USE="${MAYBE_PGPORT:-5433}"
DBNAME="${MAYBE_DBNAME:-maybe}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"   # Postgres refuses to start on macOS without a valid locale

running() { pg_ctl -D "$PGDATA_DIR" status >/dev/null 2>&1; }

case "${1:-status}" in
  init)
    if [ -d "$PGDATA_DIR/base" ]; then info "Cluster already exists at $PGDATA_DIR"; else
      info "Creating database cluster in $PGDATA_DIR"
      mkdir -p "$PGDATA_DIR"; chmod 700 "$PGDATA_DIR"
      initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 >/dev/null
    fi
    running || { mkdir -p "$PGDATA_DIR/sock"; pg_ctl -D "$PGDATA_DIR" -o "-p $PGPORT_USE -k $PGDATA_DIR/sock -c listen_addresses=localhost" -l "$PGDATA_DIR/server.log" -w start >/dev/null; }
    psql -h localhost -p "$PGPORT_USE" -U postgres -Atc "select 1 from pg_database where datname='$DBNAME'" postgres | grep -q 1 \
      || createdb -h localhost -p "$PGPORT_USE" -U postgres "$DBNAME"
    URL="postgres://postgres@localhost:$PGPORT_USE/$DBNAME"
    ok "Local database ready: $URL"
    if [ -f "$ROOT/.env" ] && grep -q '^DATABASE_URL=' "$ROOT/.env"; then
      info "Your .env already has a DATABASE_URL; leaving it alone. Local URL is: $URL"
    else
      printf 'DATABASE_URL=%s\n' "$URL" >> "$ROOT/.env"; ok "Wrote DATABASE_URL to .env"
    fi
    echo "Next: npm run db:import -- /path/to/maybe.dump"
    ;;
  start)  running && info "Already running" || { mkdir -p "$PGDATA_DIR/sock"; pg_ctl -D "$PGDATA_DIR" -o "-p $PGPORT_USE -k $PGDATA_DIR/sock -c listen_addresses=localhost" -l "$PGDATA_DIR/server.log" -w start >/dev/null; ok "Started on localhost:$PGPORT_USE"; } ;;
  stop)   running && { pg_ctl -D "$PGDATA_DIR" -m fast stop >/dev/null; ok "Stopped"; } || info "Not running" ;;
  status) if running; then ok "Running on localhost:$PGPORT_USE (data: $PGDATA_DIR)"; else info "Not running (data: $PGDATA_DIR). Start it with: npm run db:local:start"; fi ;;
  psql)   shift; exec psql -h localhost -p "$PGPORT_USE" -U postgres "$DBNAME" "$@" ;;
  path)   echo "$PGDATA_DIR" ;;
  *) die "usage: local-db.sh init|start|stop|status|psql|path" ;;
esac
