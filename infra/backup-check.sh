#!/bin/sh
# Contrôle périodique des sauvegardes : restaure la plus récente dans une base temporaire (restore-drill.sh) et alerte si cela échoue.
# Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde : ce service le vérifie tout seul, sans toucher à la base en service.
# Variables : BACKUP_DIR (/backups), BACKUP_CHECK_INTERVAL_HOURS (168 = chaque semaine), BACKUP_CHECK_FIRST_DELAY_MIN (60),
# RESTORE_DRILL (script de restauration), ERROR_WEBHOOK_URL (lien d'alerte, facultatif : sans lui, le résultat est seulement dans les journaux), CHECK_ONCE=1 (un seul contrôle, essais).
# Variables libpq attendues : PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -eu
DIR="${BACKUP_DIR:-/backups}"
EVERY="${BACKUP_CHECK_INTERVAL_HOURS:-168}"
FIRST="${BACKUP_CHECK_FIRST_DELAY_MIN:-60}"
DRILL="${RESTORE_DRILL:-/restore-drill.sh}" # emplacement du script de restauration (dans le conteneur : /restore-drill.sh)
alert() {
  [ -n "${ERROR_WEBHOOK_URL:-}" ] || return 0
  wget -q -T 10 -O /dev/null --header='Content-Type: application/json' --post-data="{\"text\":\"$1\"}" "$ERROR_WEBHOOK_URL" || echo "alerte non envoyée"
}
sleep "$((FIRST * 60))"
while true; do
  f=$(ls -1t "$DIR"/vtc-*.dump 2>/dev/null | head -1 || true)
  if [ -z "$f" ]; then
    echo "ÉCHEC : aucune sauvegarde dans $DIR"
    alert "⚠ CliCab [sauvegarde] aucune sauvegarde trouvée dans $DIR"
  elif out=$(TOLERATE=1 sh "$DRILL" "$f" 2>&1); then
    echo "contrôle ok : $(basename "$f")"; echo "$out" | tail -2
  else
    echo "ÉCHEC du contrôle : $(basename "$f")"; echo "$out" | tail -5
    alert "⚠ CliCab [sauvegarde] la restauration de $(basename "$f") a échoué : les sauvegardes ne sont peut-être pas exploitables"
  fi
  [ "${CHECK_ONCE:-0}" = "1" ] && break
  sleep "$((EVERY * 3600))"
done
