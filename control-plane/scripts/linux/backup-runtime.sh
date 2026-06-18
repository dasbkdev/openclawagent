#!/usr/bin/env bash
# Backs up company-control-plane to /var/backups/company-control-plane:
#   1. The PostgreSQL database (the source of truth: control_plane_state +
#      memory_embeddings) via `docker exec <container> pg_dump`, gzipped, with an
#      integrity + content sanity check before it is kept.
#   2. The runtime data directory (/var/lib/company-control-plane) — derived
#      per-user files (work-timeline JSONL, memory-archive, obsidian vault).
# Keeps the last RETENTION_COUNT of each kind.
#
# Usage: sudo bash ./backup-runtime.sh [--data-dir PATH] [--backup-dir PATH]
#                                      [--retention N] [--pg-container NAME]
set -euo pipefail

DATA_DIR="/var/lib/company-control-plane"
BACKUP_DIR="/var/backups/company-control-plane"
RETENTION_COUNT=14
PG_CONTAINER="starlab-cp-postgres"

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --retention) RETENTION_COUNT="$2"; shift 2 ;;
    --pg-container) PG_CONTAINER="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: sudo bash ./backup-runtime.sh [options]

Options:
  --data-dir PATH      Runtime data directory. Default: /var/lib/company-control-plane
  --backup-dir PATH    Backup output directory. Default: /var/backups/company-control-plane
  --retention N        Backups to keep per kind. Default: 14
  --pg-container NAME   Postgres docker container. Default: starlab-cp-postgres
  -h, --help           Show this help.
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root, for example with sudo." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
made_any=0

# 1) PostgreSQL logical dump (source of truth) ------------------------------
if command -v docker >/dev/null 2>&1 && docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  PG_OUT="$BACKUP_DIR/pg-$TIMESTAMP.sql.gz"
  PG_TMP="$PG_OUT.tmp"
  # pg_dump runs inside the container as the configured superuser (no password
  # needed for the local socket). --clean --if-exists makes the dump restorable
  # onto an existing database.
  if docker exec "$PG_CONTAINER" sh -c \
       'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
       | gzip -c > "$PG_TMP"; then
    # grep -c reads the whole stream (grep -q would SIGPIPE gzip, which under
    # `set -o pipefail` falsely fails the check); || true guards grep's exit 1.
    pg_matches="$(gzip -dc "$PG_TMP" | grep -c "control_plane_state" || true)"
    if gzip -t "$PG_TMP" 2>/dev/null && [ "${pg_matches:-0}" -gt 0 ]; then
      chmod 600 "$PG_TMP"
      mv "$PG_TMP" "$PG_OUT"
      echo "Postgres backup: $PG_OUT ($(du -h "$PG_OUT" | cut -f1))"
      made_any=1
    else
      rm -f "$PG_TMP"
      echo "ERROR: Postgres dump failed sanity check (empty or missing control_plane_state)" >&2
      exit 1
    fi
  else
    rm -f "$PG_TMP"
    echo "ERROR: pg_dump failed for container $PG_CONTAINER" >&2
    exit 1
  fi
else
  echo "WARN: docker container '$PG_CONTAINER' not found — skipping Postgres dump" >&2
fi

# 2) Runtime data directory (derived per-user files) -----------------------
if [ -d "$DATA_DIR" ]; then
  TAR_OUT="$BACKUP_DIR/runtime-$TIMESTAMP.tar.gz"
  TAR_TMP="$TAR_OUT.tmp"
  tar -czf "$TAR_TMP" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
  chmod 600 "$TAR_TMP"
  mv "$TAR_TMP" "$TAR_OUT"
  echo "Runtime files backup: $TAR_OUT"
  made_any=1
else
  echo "WARN: data directory not found: $DATA_DIR — skipping file tar" >&2
fi

if [ "$made_any" -ne 1 ]; then
  echo "ERROR: nothing was backed up" >&2
  exit 1
fi

# 3) Rotation: keep the most recent RETENTION_COUNT of each kind ------------
rotate() {
  local pattern="$1"
  mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" | sort)
  local count=${#files[@]}
  if [ "$count" -gt "$RETENTION_COUNT" ]; then
    local remove=$((count - RETENTION_COUNT))
    for i in $(seq 0 $((remove - 1))); do
      echo "Removing old backup: ${files[$i]}"
      rm -f "${files[$i]}"
    done
  fi
}
rotate 'pg-*.sql.gz'
rotate 'runtime-*.tar.gz'

echo "Backup complete. pg: $(find "$BACKUP_DIR" -maxdepth 1 -name 'pg-*.sql.gz' | wc -l), runtime: $(find "$BACKUP_DIR" -maxdepth 1 -name 'runtime-*.tar.gz' | wc -l)"
