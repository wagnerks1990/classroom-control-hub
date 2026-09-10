#!/usr/bin/env bash
set -Eeuo pipefail

HUB_ROOT="${CLASSROOM_HUB_DIR:-/opt/classroom-hub}"
HUB_GROUP="${HUB_INSTALL_GROUP:-classroom-hub}"
ANDROID_ROOT="$HUB_ROOT/data/android-tv"
APK="$ANDROID_ROOT/ClassroomHub-Display-Agent.apk"
META="$ANDROID_ROOT/ClassroomHub-Display-Agent.json"
BUILDER_IMAGE="classroom-hub-android-agent-builder:local"
BUILD_HOME="${CLASSROOM_HUB_ANDROID_BUILD_HOME:-/etc/classroom-control-hub/android-agent-build-home}"
PROJECT="$HUB_ROOT/agents/android-tv"

[[ -d "$PROJECT/app/src" ]] || { echo "Android agent source is missing: $PROJECT" >&2; exit 1; }
install -d -m 2770 -o root -g "$HUB_GROUP" "$ANDROID_ROOT"
install -d -m 0700 -o root -g root "$BUILD_HOME"

source_digest="$({
  find "$PROJECT" -type f \
    ! -path '*/build/*' \
    ! -path '*/.gradle/*' \
    -print0 | sort -z | xargs -0 sha256sum
} | sha256sum | awk '{print $1}')"

if [[ -s "$APK" && -s "$META" ]]; then
  staged_digest="$(python3 - "$META" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1])).get('sourceDigest',''))
except Exception: print('')
PY
)"
  staged_sha="$(python3 - "$META" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1])).get('sha256',''))
except Exception: print('')
PY
)"
  actual_sha="$(sha256sum "$APK" | awk '{print $1}')"
  if [[ "$staged_digest" == "$source_digest" && -n "$staged_sha" && "$staged_sha" == "$actual_sha" ]]; then
    chown root:"$HUB_GROUP" "$APK" "$META"
    chmod 0660 "$APK" "$META"
    echo "Android Display Agent APK already matches current source; staging retained."
    exit 0
  fi
fi

echo "Building Android Display Agent from current appliance source ..."
docker build --pull -f "$PROJECT/Dockerfile.builder" -t "$BUILDER_IMAGE" "$PROJECT"

docker run --rm \
  -v "$HUB_ROOT:/workspace" \
  -v "$BUILD_HOME:/root/.android" \
  -w /workspace/agents/android-tv \
  "$BUILDER_IMAGE" \
  gradle :app:assembleDebug --no-daemon --stacktrace

built="$PROJECT/app/build/outputs/apk/debug/app-debug.apk"
[[ -s "$built" ]] || { echo "Android agent build completed without producing $built" >&2; exit 1; }

# Verify the APK structurally using Android build-tools from the same pinned builder image.
badging="$(docker run --rm -v "$HUB_ROOT:/workspace:ro" "$BUILDER_IMAGE" \
  aapt dump badging /workspace/agents/android-tv/app/build/outputs/apk/debug/app-debug.apk | head -n 1)"
[[ "$badging" == package:*"name='org.classroomhub.display'"* ]] || { echo "Built APK has unexpected package identity: $badging" >&2; exit 1; }
version_name="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' "$PROJECT/app/build.gradle.kts" | head -n 1)"
version_code="$(sed -n 's/.*versionCode = \([0-9][0-9]*\).*/\1/p' "$PROJECT/app/build.gradle.kts" | head -n 1)"
[[ -n "$version_name" && -n "$version_code" ]] || { echo "Unable to determine Android agent version from Gradle configuration" >&2; exit 1; }
[[ "$badging" == *"versionCode='$version_code'"* && "$badging" == *"versionName='$version_name'"* ]] || { echo "Built APK version does not match Gradle configuration: $badging" >&2; exit 1; }

stage="$ANDROID_ROOT/.ClassroomHub-Display-Agent.apk.$$.tmp"
install -m 0660 -o root -g "$HUB_GROUP" "$built" "$stage"
mv -f "$stage" "$APK"
apk_sha="$(sha256sum "$APK" | awk '{print $1}')"
source_commit="$(git -C "$HUB_ROOT" rev-parse HEAD 2>/dev/null || true)"
SOURCE_DIGEST="$source_digest" APK_SHA="$apk_sha" SOURCE_COMMIT="$source_commit" VERSION_NAME="$version_name" VERSION_CODE="$version_code" META="$META" python3 - <<'PY'
import datetime,json,os
p=os.environ['META']
data={
  'package':'org.classroomhub.display',
  'versionName':os.environ['VERSION_NAME'],
  'versionCode':int(os.environ['VERSION_CODE']),
  'sourceDigest':os.environ['SOURCE_DIGEST'],
  'sourceCommit':os.environ.get('SOURCE_COMMIT',''),
  'sha256':os.environ['APK_SHA'],
  'signingMode':'appliance-persistent-debug-key',
  'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
tmp=p+'.tmp'
with open(tmp,'w') as f: json.dump(data,f,indent=2,sort_keys=True)
os.replace(tmp,p)
PY
chown root:"$HUB_GROUP" "$META"
chmod 0660 "$META"

echo "Staged Android Display Agent $version_name (versionCode $version_code, sha256 ${apk_sha:0:12}...)."
