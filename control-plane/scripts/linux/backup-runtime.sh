#!/usr/bin/env bash
# Backs up the company-control-plane runtime data directory
# (/var/lib/company-control-plane, including memory-archive) to a timestamped
# tar.gz under /var/backups/company-control-plane, keeping the last
# RETENTION_COUNT archives.
#
# Usage: sudo ./backup-runtime.sh [--data-dir PATH] [--backup-dir PATH] [--retention N]
set -euo pipefail

DATA_DIR="/var/lib/company-control-plane"
BACKUP_DIR="/var/backups/company-control-plane"
RETENTION_COUNT=14

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --retention) RETENTION_COUNT="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: sudo ./backup-runtime.sh [options]

Options:
  --data-dir PATH    Runtime data directory to back up. Default: /var/lib/company-control-plane
  --backup-dir PATH  Directory to store backup archives. Default: /var/backups/company-control-plane
  --retention N      Number of archives to keep. Default: 14
  -h, --help         Show this help.
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

if [ ! -d "$DATA_DIR" ]; then
  echo "Data directory not found: $DATA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE_PATH="$BACKUP_DIR/runtime-$TIMESTAMP.tar.gz"
TMP_PATH="$ARCHIVE_PATH.tmp"

tar -czf "$TMP_PATH" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
chmod 600 "$TMP_PATH"
mv "$TMP_PATH" "$ARCHIVE_PATH"

echo "Created backup: $ARCHIVE_PATH"

# Rotation: keep only the most recent RETENTION_COUNT archives.
mapfile -t ARCHIVES < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'runtime-*.tar.gz' | sort)
ARCHIVE_COUNT=${#ARCHIVES[@]}
if [ "$ARCHIVE_COUNT" -gt "$RETENTION_COUNT" ]; then
  REMOVE_COUNT=$((ARCHIVE_COUNT - RETENTION_COUNT))
  for i in $(seq 0 $((REMOVE_COUNT - 1))); do
    echo "Removing old backup: ${ARCHIVES[$i]}"
    rm -f "${ARCHIVES[$i]}"
  done
fi

echo "Backup complete. Archives retained: $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'runtime-*.tar.gz' | wc -l)"
