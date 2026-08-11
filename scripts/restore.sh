#!/usr/bin/env bash
# Restauration d'une sauvegarde FindUrJob.
#
#   ./scripts/restore.sh                 # dernière sauvegarde
#   ./scripts/restore.sh 20260811-183000 # sauvegarde précise
#
# Les collections restaurées écrasent celles en place (--drop).
set -euo pipefail

DB="${MONGO_DB:-findurjob}"
CONTAINER="${MONGO_CONTAINER:-findurjob-mongo}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="${1:-}"

if [ -z "$STAMP" ]; then
  STAMP="$(ls -1 "$ROOT/backups" 2>/dev/null | sort | tail -1 || true)"
fi
if [ -z "$STAMP" ] || [ ! -f "$ROOT/backups/$STAMP/$DB.archive.gz" ]; then
  echo "Aucune sauvegarde trouvée." >&2
  echo "Disponibles :" >&2
  ls -1 "$ROOT/backups" 2>/dev/null >&2 || echo "  (aucune)" >&2
  exit 1
fi

echo "Restauration de « $DB » depuis $STAMP (les collections en place seront écrasées)…"
docker exec -i "$CONTAINER" mongorestore --db "$DB" --archive --gzip --drop \
  < "$ROOT/backups/$STAMP/$DB.archive.gz"
echo "✓ Restauré."
