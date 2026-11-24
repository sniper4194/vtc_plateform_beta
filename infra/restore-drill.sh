#!/bin/sh
# Exercice de restauration : prouve qu'une sauvegarde est exploitable SANS toucher à la base en service.
#   1. restaure la sauvegarde dans une base temporaire ;
#   2. compare le nombre de lignes de chaque table avec la base en service ;
#   3. supprime la base temporaire.
# Variables libpq attendues : PGHOST, PGUSER, PGPASSWORD, PGDATABASE (la base en service).
# Usage : sh restore-drill.sh /backups/vtc-AAAAMMJJ-HHMMSS.dump        (code de sortie 0 = sauvegarde exploitable)
# Attention : une sauvegarde est un instantané ; si la base a changé depuis, de petits écarts sont normaux (option TOLERATE=1).
set -eu
DUMP="${1:?Usage : restore-drill.sh <fichier .dump>}"
[ -s "$DUMP" ] || { echo "ÉCHEC : fichier de sauvegarde absent ou vide : $DUMP" >&2; exit 2; }
TMP="restore_drill_$(date +%s)"
LIVE="${PGDATABASE:?PGDATABASE requis}"
cleanup() { psql -d "$LIVE" -qAtc "DROP DATABASE IF EXISTS \"$TMP\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql -d "$LIVE" -qAtc "CREATE DATABASE \"$TMP\""
pg_restore -d "$TMP" --no-owner --exit-on-error "$DUMP"
tables=$(psql -d "$TMP" -qAtc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
bad=0; total=0
for t in $tables; do
  a=$(psql -d "$TMP" -qAtc "SELECT count(*) FROM \"$t\"")
  b=$(psql -d "$LIVE" -qAtc "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo "absente")
  total=$((total + 1))
  if [ "$a" != "$b" ]; then bad=$((bad + 1)); echo "écart : $t  sauvegarde=$a  base=$b"; fi
done
echo "tables restaurées : $total, écarts : $bad"
if [ "$bad" -gt 0 ] && [ "${TOLERATE:-0}" != "1" ]; then echo "ÉCHEC : la sauvegarde ne correspond pas à la base (voir les écarts)." >&2; exit 1; fi
echo "OK : la sauvegarde se restaure et son contenu correspond."
