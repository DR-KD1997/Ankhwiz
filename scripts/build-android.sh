#!/usr/bin/env bash
# Build the interim Android app: the shared interface (one file) inside a
# small web-view shell, using only the plain Android tools (aapt, javac,
# dx, zipalign, apksigner) and one platform android.jar.
#
#   ANDROID_JAR  path to an android.jar, API 23 or later
#   DX           the dex compiler: `dx`, `dalvik-exchange`, or d8 wrapped the same way
#
# Signing. Android only installs an update signed with the same key as the
# app already on the phone, so the key must stay the same from one build to
# the next:
#
#   ANKHWIZ_KEYSTORE, ANKHWIZ_KEYSTORE_PASS, ANKHWIZ_KEY_ALIAS, ANKHWIZ_KEY_PASS
#       a release key of your own (keep it safe; losing it means users must
#       uninstall to update). The APK is then named …-release.apk.
#   otherwise android/debug.keystore, made once and then reused. It is a test
#   key with a public password: fine for your own phone, not for publishing.
#   Keep the file (it is not in the repository) to update over earlier builds.
set -euo pipefail
cd "$(dirname "$0")/.."
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
DX="${DX:-dalvik-exchange}"
OUT=android/build
# package.json keeps semver ("0.4.1+1"); files are named as people see it ("0.4.1.1").
VERSION="$(node -p "require('./package.json').version.replace('+', '.')")"
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
if [[ "$(basename "$DX")" == d8* ]]; then
  (cd "$OUT" && "$DX" --min-api 24 --output . $(find classes -name '*.class') && aapt add unaligned.apk classes.dex >/dev/null)
else
  (cd "$OUT" && "$DX" --dex --output=classes.dex classes && aapt add unaligned.apk classes.dex >/dev/null)
fi
zipalign -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

if [[ -n "${ANKHWIZ_KEYSTORE:-}" ]]; then
  APK="$OUT/Ankhwiz-$VERSION-release.apk"
  apksigner sign --ks "$ANKHWIZ_KEYSTORE" --ks-pass "pass:$ANKHWIZ_KEYSTORE_PASS" --ks-key-alias "${ANKHWIZ_KEY_ALIAS:-ankhwiz}" \
    --key-pass "pass:${ANKHWIZ_KEY_PASS:-$ANKHWIZ_KEYSTORE_PASS}" --out "$APK" "$OUT/aligned.apk"
else
  KEY=android/debug.keystore
  if [[ ! -f "$KEY" ]]; then
    echo "Making a new test key in $KEY. Phones with an app signed by another key must uninstall it first." >&2
    keytool -genkeypair -keystore "$KEY" -storepass android -keypass android -alias debug \
      -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Ankhwiz debug" >/dev/null 2>&1
  fi
  APK="$OUT/Ankhwiz-$VERSION-debug.apk"
  apksigner sign --ks "$KEY" --ks-pass pass:android --key-pass pass:android --out "$APK" "$OUT/aligned.apk"
fi
apksigner verify --verbose "$APK" | head -5
ls -l "$APK"
