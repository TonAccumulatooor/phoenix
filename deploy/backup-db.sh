#!/usr/bin/env bash
# Nightly SQLite backup. Install with:
#   (crontab -l 2>/dev/null; echo "0 4 * * * /root/phoenix/deploy/backup-db.sh") | crontab -
set -euo pipefail

COMPOSE=/root/phoenix/compose.yml
BACKUP_DIR=/root/phoenix-backups
KEEP_DAYS=30
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# Python's sqlite3 .backup API is safe on a live database; a plain file copy
# is not. Used here because the slim image has Python but no sqlite3 CLI.
docker compose -f "$COMPOSE" exec -T backend python -c "
import sqlite3
src = sqlite3.connect('/data/phoenix.db')
dst = sqlite3.connect('/data/backup-$STAMP.db')
with dst:
    src.backup(dst)
dst.close(); src.close()
"

docker compose -f "$COMPOSE" cp "backend:/data/backup-$STAMP.db" "$BACKUP_DIR/phoenix-$STAMP.db"
docker compose -f "$COMPOSE" exec -T backend rm -f "/data/backup-$STAMP.db"

gzip -f "$BACKUP_DIR/phoenix-$STAMP.db"
find "$BACKUP_DIR" -name 'phoenix-*.db.gz' -mtime +$KEEP_DAYS -delete

echo "Backup written: $BACKUP_DIR/phoenix-$STAMP.db.gz"
