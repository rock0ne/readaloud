#!/usr/bin/env bash
# Signs a release APK with your own key (ADR-29). apksigner asks for the key's password, which
# is not stored anywhere. Usage: app/android/sign-apk.sh <keystore> <unsigned.apk> <signed.apk>
# ANDROID_HOME (and JAVA_HOME unless java is on PATH) as for build-apk.sh. The key alias is
# "readaloud" unless KEY_ALIAS says otherwise.
set -euo pipefail
[ $# -eq 3 ] || { echo "Usage: $0 <keystore> <unsigned.apk> <signed.apk>" >&2; exit 2; }
KS=$1 IN=$2 OUT=$3
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
if [ -n "${JAVA_HOME:-}" ]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
BT=$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)
"$BT/zipalign" -c -p 4 "$IN" >/dev/null || { echo "$IN is not zip-aligned." >&2; exit 1; }
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "${KEY_ALIAS:-readaloud}" --out "$OUT" "$IN"
"$BT/apksigner" verify --print-certs "$OUT" | grep -E "certificate (DN|SHA-256)"
sha256sum "$OUT"
