#!/usr/bin/env bash
# Run backups automatically every day.
#   schedule-backup.sh install [HH:MM]   (default 02:30)   |   remove   |   status   |   install --dry-run
# macOS: a launchd agent (runs when you're logged in; if the Mac was asleep it runs when it wakes).
# Linux: prints the crontab line to add. Nothing is installed unless you run `install`.
source "$(dirname "$0")/common.sh"
CMD="${1:-status}"; shift || true
TIME="02:30"; DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; [0-2][0-9]:[0-5][0-9]) TIME="$a" ;; *) die "unknown option: $a" ;; esac; done
HH="${TIME%:*}"; MM="${TIME#*:}"
LABEL="com.maybe-lite.backup"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/.maybe-lite/backup.log"
BACKUP_SH="$ROOT/scripts/db/backup.sh"

plist() { cat <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$BACKUP_SH</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$((10#$HH))</integer><key>Minute</key><integer>$((10#$MM))</integer></dict>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string><key>HOME</key><string>$HOME</string></dict>
  <key>StandardOutPath</key><string>$LOG</string><key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
}

case "$CMD" in
  install)
    if [ "$(uname)" != "Darwin" ]; then
      echo "On Linux add this line with 'crontab -e':"; echo "$((10#$MM)) $((10#$HH)) * * * /bin/bash $BACKUP_SH >> $LOG 2>&1"; exit 0
    fi
    if [ "$DRY" -eq 1 ]; then plist; exit 0; fi
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    plist > "$PLIST"; launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"
    ok "Daily backup scheduled for $TIME → $BACKUP_DIR${BACKUP_MIRROR_DIR:+ (+ mirror $BACKUP_MIRROR_DIR)}"
    info "Log: $LOG    Undo with: npm run db:backup:schedule -- remove" ;;
  remove)
    [ -f "$PLIST" ] && { launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; ok "Scheduled backup removed"; } || info "No schedule installed" ;;
  status)
    [ -f "$PLIST" ] && ok "Scheduled (launchd): $PLIST" || info "No schedule installed. Add one with: npm run db:backup:schedule -- install 02:30"
    [ -f "$LOG" ] && { echo "Last log lines:"; tail -n 4 "$LOG" | sed 's/^/    /'; } || true ;;
  *) die "usage: schedule-backup.sh install [HH:MM] | remove | status" ;;
esac
