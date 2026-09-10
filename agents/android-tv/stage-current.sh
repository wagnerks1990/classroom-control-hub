#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${ANDROID_AGENT_SOURCE_ROOT:-/workspace/agents/android-tv}"
STAGE_ROOT="${ANDROID_AGENT_STAGE_ROOT:-/stage}"
SIGNING_ROOT="${ANDROID_AGENT_SIGNING_ROOT:-/signing}"
STAGE_GID="${ANDROID_AGENT_STAGE_GID:-10001}"
APK_TARGET="$STAGE_ROOT/ClassroomHub-Display-Agent.apk"
META_TARGET="$STAGE_ROOT/ClassroomHub-Display-Agent.json"
KEYSTORE="$SIGNING_ROOT/ClassroomHub-Display-Agent.keystore"
PASSWORD_FILE="$SIGNING_ROOT/password"
ALIAS=classroom-hub

mkdir -p "$STAGE_ROOT" "$SIGNING_ROOT"
chmod 0700 "$SIGNING_ROOT" || true

source_digest="$({
  find "$SOURCE_ROOT" -type f \
    ! -path '*/build/*' \
    ! -path '*/.gradle/*' \
    ! -name 'ClassroomHub-Display-Agent.apk' \
    ! -name 'ClassroomHub-Display-Agent.json' \
    -print0 | sort -z | xargs -0 sha256sum
} | sha256sum | awk '{print $1}')"

if [[ -s "$APK_TARGET" && -s "$META_TARGET" ]]; then
  read -r old_digest old_sha < <(python3 - "$META_TARGET" <<'PY'
import json,sys
try:
    j=json.load(open(sys.argv[1]))
    print(j.get('sourceDigest',''),j.get('sha256',''))
except Exception:
    print('','')
PY
)
  actual_sha="$(sha256sum "$APK_TARGET" | awk '{print $1}')"
  if [[ "$old_digest" == "$source_digest" && -n "$old_sha" && "$old_sha" == "$actual_sha" ]]; then
    chgrp "$STAGE_GID" "$APK_TARGET" "$META_TARGET"
    chmod 0660 "$APK_TARGET" "$META_TARGET"
    echo "Android Display Agent staging already matches current source."
    exit 0
  fi
fi

if [[ ! -s "$KEYSTORE" || ! -s "$PASSWORD_FILE" ]]; then
  echo "Creating persistent per-appliance Android agent signing identity ..."
  umask 077
  password="$(openssl rand -hex 24)"
  printf '%s\n' "$password" > "$PASSWORD_FILE"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass "$password" \
    -keypass "$password" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 3072 -validity 10000 \
    -dname "CN=Classroom Control Hub Android Agent,O=Classroom Control Hub"
  chmod 0600 "$PASSWORD_FILE" "$KEYSTORE"
fi

password="$(tr -d '\r\n' < "$PASSWORD_FILE")"
[[ ${#password} -ge 24 ]] || { echo "Android agent signing password is invalid" >&2; exit 1; }

work=/tmp/classroom-hub-android-agent
rm -rf "$work"
mkdir -p "$work"
cp -a "$SOURCE_ROOT/." "$work/"
rm -rf "$work/app/build" "$work/.gradle" "$work/app/.gradle"

export CLASSROOM_HUB_ANDROID_KEYSTORE="$KEYSTORE"
export CLASSROOM_HUB_ANDROID_STORE_PASSWORD="$password"
export CLASSROOM_HUB_ANDROID_KEY_ALIAS="$ALIAS"
export CLASSROOM_HUB_ANDROID_KEY_PASSWORD="$password"

echo "Building current Classroom Hub Android Display Agent ..."
cd "$work"
gradle :app:assembleDebug --no-daemon --stacktrace
built="$work/app/build/outputs/apk/debug/app-debug.apk"
[[ -s "$built" ]] || { echo "Android agent build produced no APK" >&2; exit 1; }

badging="$(aapt dump badging "$built" | head -n1)"
[[ "$badging" == package:*"name='org.classroomhub.display'"* ]] || { echo "Unexpected Android package identity: $badging" >&2; exit 1; }
version_name="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' "$work/app/build.gradle.kts" | head -n1)"
version_code="$(sed -n 's/.*versionCode = \([0-9][0-9]*\).*/\1/p' "$work/app/build.gradle.kts" | head -n1)"
[[ -n "$version_name" && -n "$version_code" ]] || { echo "Unable to resolve Android agent version" >&2; exit 1; }
[[ "$badging" == *"versionCode='$version_code'"* && "$badging" == *"versionName='$version_name'"* ]] || { echo "APK/Gradle version mismatch: $badging" >&2; exit 1; }

apksigner verify --verbose --print-certs "$built" >/tmp/apksigner.txt
signer_sha="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' /tmp/apksigner.txt | head -n1 | tr 'A-F' 'a-f')"
[[ "$signer_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "Unable to verify Android agent signing certificate" >&2; exit 1; }
apk_sha="$(sha256sum "$built" | awk '{print $1}')"

stage_tmp="$STAGE_ROOT/.ClassroomHub-Display-Agent.apk.$$.tmp"
install -m 0660 "$built" "$stage_tmp"
chgrp "$STAGE_GID" "$stage_tmp"
mv -f "$stage_tmp" "$APK_TARGET"

SOURCE_DIGEST="$source_digest" APK_SHA="$apk_sha" SIGNER_SHA="$signer_sha" VERSION_NAME="$version_name" VERSION_CODE="$version_code" META_TARGET="$META_TARGET" python3 - <<'PY'
import datetime,json,os
p=os.environ['META_TARGET']
data={
  'package':'org.classroomhub.display',
  'versionName':os.environ['VERSION_NAME'],
  'versionCode':int(os.environ['VERSION_CODE']),
  'sourceDigest':os.environ['SOURCE_DIGEST'],
  'sha256':os.environ['APK_SHA'],
  'signerSha256':os.environ['SIGNER_SHA'],
  'signingMode':'persistent-per-appliance',
  'source':'compose-android-agent-builder',
  'stagedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
tmp=p+'.tmp'
with open(tmp,'w') as f: json.dump(data,f,indent=2,sort_keys=True)
os.chmod(tmp,0o660)
os.replace(tmp,p)
PY
chgrp "$STAGE_GID" "$META_TARGET"
chmod 0660 "$APK_TARGET" "$META_TARGET"
echo "Staged Android Display Agent $version_name (versionCode $version_code, signer ${signer_sha:0:12}..., sha256 ${apk_sha:0:12}...)."
