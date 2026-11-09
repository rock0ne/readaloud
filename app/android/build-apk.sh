#!/usr/bin/env bash
# Builds ReadAloud's Android APK (ADR-27, ADR-29) on Linux or in WSL, from a checkout on the
# Linux disk. Usage: app/android/build-apk.sh [debug|release]
#
# Needs Node 22 with pnpm (corepack enable), JDK 21, the Android SDK with platform 36, and the
# sherpa-onnx Kokoro engine APK (see README.md), whose two native libraries the app uses:
#
#   JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/android-sdk \
#   SHERPA_ENGINE_APK=/path/to/sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk \
#   app/android/build-apk.sh release
#
# A release build is unsigned: sign it with your own key (app/android/sign-apk.sh).
set -euo pipefail
TYPE=${1:-debug}
case "$TYPE" in
  debug) TASK=assembleDebug ;;
  release) TASK=assembleRelease ;;
  *) echo "Usage: $0 [debug|release]" >&2; exit 2 ;;
esac
: "${JAVA_HOME:?Set JAVA_HOME to a JDK 21}"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
: "${SHERPA_ENGINE_APK:?Set SHERPA_ENGINE_APK to the sherpa-onnx Kokoro engine APK}"
export PATH="$JAVA_HOME/bin:$PATH"
PNPM=pnpm
command -v pnpm >/dev/null || PNPM="corepack pnpm"

APP=$(cd "$(dirname "$0")/.." && pwd)
cd "$APP"
[ -d node_modules ] || $PNPM install --frozen-lockfile
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build --mode android
# sync, not copy: it also makes the git-ignored capacitor-cordova-android-plugins folder.
node node_modules/@capacitor/cli/bin/capacitor sync android

# Offline edition: carry the existing pinned model/voice archive in the APK itself.
# All speakers share one model; choosing five narrators does not need five models.
VOICE_ZIP=${READALOUD_VOICE_ZIP:-"$APP/release/readaloud-kokoro-voice-2.zip"}
python3 -I - "$VOICE_ZIP" "$APP/android/app/src/main/assets/readaloud-kokoro-voice-2.zip" <<'PY'
import hashlib, pathlib, shutil, sys
source, target = map(pathlib.Path, sys.argv[1:])
digest = hashlib.file_digest(source.open('rb'), 'sha256').hexdigest()
if source.stat().st_size != 328761892 or digest != '207abec0ca2ac0288df2a3b4796fbb2531ab851e3890fd960917d94ab2513eca':
    raise SystemExit('The bundled voice archive is not the pinned ReadAloud voice-2 asset')
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, target)
PY

# sherpa-onnx's native libraries, unchanged from the engine APK (git-ignored here).
JNI=android/app/src/main/jniLibs/arm64-v8a
mkdir -p "$JNI"
python3 -I - "$SHERPA_ENGINE_APK" "$JNI" <<'PY'
import sys, zipfile
apk, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk) as z:
    for name in ('libsherpa-onnx-jni.so', 'libonnxruntime.so'):
        with open(f'{out}/{name}', 'wb') as f:
            f.write(z.read(f'lib/arm64-v8a/{name}'))
PY

cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
sh ./gradlew --no-daemon --console=plain "$TASK"
ls -l app/build/outputs/apk/"$TYPE"/*.apk
