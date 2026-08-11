#!/usr/bin/env bash
# Sauvegarde de la base FindUrJob dans backups/<horodatage>/
#
#   ./scripts/backup.sh
#
# À lancer avant toute manipulation d'infrastructure (renommage, down -v,
# changement de MONGO_URI). Une base perdue ne se reconstitue pas.
set -euo pipefail

DB="${MONGO_DB:-findurjob}"
CONTAINER="${MONGO_CONTAINER:-findurjob-mongo}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$(cd "$(dirname "$0")/.." && pwd)/backups/$STAMP"

mkdir -p "$DEST"

echo "Sauvegarde de « $DB » depuis $CONTAINER…"
docker exec "$CONTAINER" mongodump --db "$DB" --archive --gzip > "$DEST/$DB.archive.gz"

SIZE=$(du -h "$DEST/$DB.archive.gz" | cut -f1)
echo "✓ $DEST/$DB.archive.gz ($SIZE)"
echo
echo "Restauration :  ./scripts/restore.sh $STAMP"
