#!/bin/sh
# Parcours no-show sur le téléphone virtuel (un seul script : l'action de l'émulateur exécute chaque ligne séparément,
# une variable ne survivrait pas d'une ligne à l'autre). Échoue si le parcours s'interrompt ou si l'application s'arrête.
set -u
OK=1
adb install -r apk/*.apk
adb logcat -c
maestro test --format junit --output maestro.xml --debug-output maestro-debug apps/driver-app/e2e/no-show.yaml || { echo "PARCOURS INTERROMPU"; OK=0; }
sleep 8
adb logcat -d > logcat-no-show.txt
adb logcat -d -b crash > crash-no-show.txt || true
echo "=== Plantages ==="; cat crash-no-show.txt
echo "=== Erreurs ==="; grep -E "FATAL|AndroidRuntime|ReactNativeJS|JavascriptException|API key" logcat-no-show.txt | head -120 || true
adb shell pidof com.clicab.driver || { echo "APPLICATION ARRÊTÉE"; OK=0; }
grep -q "FATAL EXCEPTION" crash-no-show.txt && { echo "PLANTAGE DÉTECTÉ"; OK=0; }
[ "$OK" = 1 ] && echo "Parcours complet, application toujours en marche" || exit 1
