#!/usr/bin/env bash
# Build the interim Android app: the shared interface (one file) inside a
# small web-view shell, using only the plain Android tools (aapt, javac,
# dx, zipalign, apksigner) and one platform android.jar.
#
#   ANDROID_JAR  path to an android.jar, API 23 or later
#   DX           the dex compiler: `dx`, `dalvik-exchange`, or d8 wrapped the same way
#
# The APK is signed with a throwaway debug key, so it installs for testing
# but cannot be published or updated over a differently signed copy.
set -euo pipefail
cd "$(dirname "$0")/.."
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
DX="${DX:-dalvik-exchange}"
OUT=android/build
rm -rf "$OUT" && mkdir -p "$OUT/classes" "$OUT/assets" "$OUT/res"

npm run build:single
cp dist-single/index.html "$OUT/assets/index.html"

# Launcher icons made by `npx tauri icon`.
cp -r android/res/. "$OUT/res/"
for d in src-tauri/icons/android/mipmap-*dpi; do
  mkdir -p "$OUT/res/$(basename "$d")"
  cp "$d/ic_launcher.png" "$OUT/res/$(basename "$d")/ic_launcher.png"
done

aapt package -f -M android/AndroidManifest.xml -S "$OUT/res" -A "$OUT/assets" -I "$ANDROID_JAR" -F "$OUT/unaligned.apk"
javac --release 8 -Xlint:-options -cp "$ANDROID_JAR" -d "$OUT/classes" android/src/app/ankhwiz/*.java
(cd "$OUT" && "$DX" --dex --output=classes.dex classes && aapt add unaligned.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

KEY="$OUT/debug.keystore"
keytool -genkeypair -keystore "$KEY" -storepass android -keypass android -alias debug \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Ankhwiz debug" >/dev/null 2>&1
apksigner sign --ks "$KEY" --ks-pass pass:android --key-pass pass:android --out "$OUT/Ankhwiz-0.3.0-debug.apk" "$OUT/aligned.apk"
apksigner verify --verbose "$OUT/Ankhwiz-0.3.0-debug.apk" | head -5
ls -l "$OUT/Ankhwiz-0.3.0-debug.apk"
