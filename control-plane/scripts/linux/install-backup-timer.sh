#!/usr/bin/env bash
# Installs a systemd oneshot service + daily timer that runs
# backup-runtime.sh from /opt/company-control-plane/scripts/linux/.
#
# Usage: sudo ./install-backup-timer.sh [--install-dir PATH]
set -euo pipefail

INSTALL_DIR="/opt/company-control-plane"

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: sudo ./install-backup-timer.sh [options]

Options:
  --install-dir PATH  Directory where company-control-plane is installed.
                       Default: /opt/company-control-plane
  -h, --help          Show this help.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root, for example with sudo." >&2
  exit 1
fi

BACKUP_SCRIPT="$INSTALL_DIR/scripts/linux/backup-runtime.sh"
if [ ! -f "$BACKUP_SCRIPT" ]; then
  echo "Backup script not found: $BACKUP_SCRIPT" >&2
  exit 1
fi
chmod +x "$BACKUP_SCRIPT"

SERVICE_PATH="/etc/systemd/system/company-control-plane-backup.service"
TIMER_PATH="/etc/systemd/system/company-control-plane-backup.timer"

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Backup company-control-plane runtime data
After=network.target

[Service]
Type=oneshot
# Run via bash so a missing execute bit never breaks the unit (203/EXEC).
ExecStart=/bin/bash $BACKUP_SCRIPT
EOF

cat > "$TIMER_PATH" <<EOF
[Unit]
Description=Daily backup of company-control-plane runtime data

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable company-control-plane-backup.timer
systemctl start company-control-plane-backup.timer

echo "Installed company-control-plane-backup.service and .timer"
systemctl list-timers company-control-plane-backup.timer --no-pager || true
