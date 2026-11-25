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

if ! adb shell pidof com.clicab.driver || grep -Eq 'Process: com\.clicab\.driver(,|$)' crash-no-show.txt; then
  echo "::error::L’application chauffeur s’est arrêtée ou a planté pendant le parcours no-show."
  exit 1
fi

if (( maestro_status != 0 )); then
  echo "::error::Le scénario Maestro no-show a échoué (code ${maestro_status})."
fi
exit "$maestro_status"
