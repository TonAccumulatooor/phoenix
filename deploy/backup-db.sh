#!/usr/bin/env bash
# Nightly SQLite backup. Install with:
#   (crontab -l 2>/dev/null; echo "0 4 * * * /root/phoenix/deploy/backup-db.sh") | crontab -
set -euo pipefail

BACKUP_DIR=/root/phoenix-backups
KEEP_DAYS=30
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# .backup is safe on a live database; a plain file copy is not.
docker compose -f /root/phoenix/compose.yml exec -T backend \
  sqlite3 /data/phoenix.db ".backup '/data/backup-$STAMP.db'"

docker compose -f /root/phoenix/compose.yml cp \
  "backend:/data/backup-$STAMP.db" "$BACKUP_DIR/phoenix-$STAMP.db"

docker compose -f /root/phoenix/compose.yml exec -T backend \
  rm -f "/data/backup-$STAMP.db"

gzip -f "$BACKUP_DIR/phoenix-$STAMP.db"
find "$BACKUP_DIR" -name 'phoenix-*.db.gz' -mtime +$KEEP_DAYS -delete

echo "Backup written: $BACKUP_DIR/phoenix-$STAMP.db.gz"
