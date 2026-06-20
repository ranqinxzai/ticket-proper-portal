#!/bin/sh
# Daily ticket-db backup. Writes a gzipped pg_dump to BACKUP_DIR and keeps
# the last 14 days. Runs from cron — no interactive prompts.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/home/santhosh/ticketingsystem/backups}"
CONTAINER="${CONTAINER:-ticket-db}"
DB_NAME="${DB_NAME:-ticketing_system}"
DB_USER="${DB_USER:-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$OUT"

# Rotate
find "$BACKUP_DIR" -type f -name "${DB_NAME}_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "[backup-db] wrote $OUT"
