#!/usr/bin/env bash
set -euo pipefail

adb install -r apk/*.apk
adb logcat -c

maestro_status=0
maestro test --format junit --output maestro.xml --debug-output maestro-debug apps/driver-app/e2e/no-show.yaml || maestro_status=$?

sleep 8
adb logcat -d > logcat-no-show.txt
adb logcat -d -b crash > crash-no-show.txt || true
echo "=== Plantages ==="
cat crash-no-show.txt
echo "=== Erreurs ==="
grep -E "FATAL|AndroidRuntime|ReactNativeJS|JavascriptException|IllegalState|API key" logcat-no-show.txt | head -120 || true

if ! adb shell pidof com.clicab.driver || grep -Eq 'FATAL EXCEPTION|Process: com\.clicab\.driver(,|$)' crash-no-show.txt; then
  echo "::error::L’application chauffeur s’est arrêtée ou a planté pendant le parcours no-show."
  exit 1
fi

if (( maestro_status != 0 )); then
  # Les captures ne sont lisibles qu'en téléchargeant l'archive : on écrit aussi dans le journal
  # les textes affichés à l'écran au moment de l'échec, et les dernières lignes du serveur de test.
  echo "=== Textes à l'écran au moment de l'échec ==="
  adb shell uiautomator dump /sdcard/ecran.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/ecran.xml 2>/dev/null | grep -oE '(text|content-desc)="[^"]+"' | sed 's/&#10;/ /g' | head -80 || true
  echo "=== Fin du journal du serveur de test ==="
  tail -40 api.log 2>/dev/null || true
  echo "::error::Le scénario Maestro no-show a échoué (code ${maestro_status})."
fi
exit "$maestro_status"
