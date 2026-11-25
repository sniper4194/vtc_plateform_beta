#!/bin/sh
# Sauvegarde de la base : une copie compressée (format pg_dump -Fc) tous les BACKUP_INTERVAL_HOURS heures, dans /backups.
# Les copies de plus de BACKUP_RETENTION_DAYS jours sont supprimées. BACKUP_ONCE=1 : une seule sauvegarde puis arrêt (essais).
# Variables libpq attendues : PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -eu
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_RETENTION_DAYS:-14}"
EVERY="${BACKUP_INTERVAL_HOURS:-24}"
mkdir -p "$DIR"
while true; do
  f="$DIR/vtc-$(date -u +%Y%m%d-%H%M%S).dump"
  if pg_dump -Fc -f "$f.part"; then
    mv "$f.part" "$f"
    echo "sauvegarde ok : $f ($(wc -c < "$f") octets)"
    find "$DIR" -name 'vtc-*.dump' -mtime +"$KEEP" -delete
  else
    rm -f "$f.part"
    echo "ÉCHEC de la sauvegarde" >&2
  fi
  [ "${BACKUP_ONCE:-0}" = "1" ] && break
  sleep "$((EVERY * 3600))"
done
