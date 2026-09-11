#!/usr/bin/env bash
set -euo pipefail

CONFIGURED_KEY="${VEYON_KEY_NAME:-master}"
KEY_NAME="$CONFIGURED_KEY"
TARGET_DIR="/etc/classroom-control-hub/veyon"
PRIVATE_TARGET="$TARGET_DIR/private.pem"
PUBLIC_TARGET="$TARGET_DIR/public.pem"
APP_GID="${APP_GID:-10001}"

command -v veyon-cli >/dev/null 2>&1 || exit 0

# Key names are passed to veyon-cli only. Keep the accepted form deliberately
# narrow so environment/configuration values cannot become command arguments.
[[ "$KEY_NAME" =~ ^[A-Za-z][A-Za-z0-9._-]*$ ]] || { echo "Invalid VEYON_KEY_NAME: $KEY_NAME" >&2; exit 1; }

has_key(){
  local key="$1"
  local type="$2"
  veyon-cli authkeys list details 2>/dev/null | grep -Eq "^\|[[:space:]]*${key}[[:space:]]*\|[[:space:]]*${type}[[:space:]]*\|"
}

has_private_key(){ has_key "$1" private; }
has_public_key(){ has_key "$1" public; }

# Upgrades through alpha.71 may retain VEYON_KEY_NAME=ClassroomControlHub even
# when the appliance's actual native pair is named master. Adopt the verified
# native master pair rather than silently leaving a stale/empty compatibility
# file. Never generate or rotate a key implicitly.
if ! has_private_key "$KEY_NAME"; then
  if [[ "$KEY_NAME" != "master" ]] && has_private_key master; then
    echo "Configured Veyon key '$KEY_NAME' is not present; adopting native 'master' key for migration." >&2
    KEY_NAME="master"
  else
    echo "Native Veyon private key '$KEY_NAME' was not found; key synchronization skipped." >&2
    exit 0
  fi
fi

install -d -m 0750 "$TARGET_DIR"
# GNU chown accepts a numeric group ID even when there is no /etc/group entry.
chown "root:${APP_GID}" "$TARGET_DIR"

# veyon-cli authkeys export refuses to overwrite an existing file. Use a private
# temporary directory, but let the export targets themselves remain nonexistent
# until veyon-cli creates them.
tmp_dir="$(mktemp -d "$TARGET_DIR/.sync.XXXXXX")"
private_tmp="$tmp_dir/private.pem"
public_tmp="$tmp_dir/public.pem"
cleanup(){ rm -rf "$tmp_dir"; }
trap cleanup EXIT

veyon-cli authkeys export "$KEY_NAME/private" "$private_tmp" >/dev/null

# Reuse the existing matching public key when present. Extracting a public key
# from an existing private key fails if that public key already exists, so only
# extract on hosts where the public half is actually missing.
if ! has_public_key "$KEY_NAME"; then
  veyon-cli authkeys extract "$KEY_NAME" >/dev/null
fi
veyon-cli authkeys export "$KEY_NAME/public" "$public_tmp" >/dev/null

[[ -s "$private_tmp" ]] || { echo "Veyon private-key export was empty" >&2; exit 1; }
[[ -s "$public_tmp" ]] || { echo "Veyon public-key export was empty" >&2; exit 1; }

chmod 0640 "$private_tmp"
chmod 0644 "$public_tmp"
chown "root:${APP_GID}" "$private_tmp"
chown root:root "$public_tmp"

# Atomic replacement also eliminates zero-byte files left by older installers.
mv -f "$private_tmp" "$PRIVATE_TARGET"
mv -f "$public_tmp" "$PUBLIC_TARGET"
rmdir "$tmp_dir"
trap - EXIT

# Record the native key name without copying secret material. The application
# remains database-authoritative; this marker exists only to make upgrade
# diagnostics and migration deterministic when a legacy environment key name
# was stale.
printf '%s\n' "$KEY_NAME" > "$TARGET_DIR/key-name"
chmod 0644 "$TARGET_DIR/key-name"
chown root:root "$TARGET_DIR/key-name"

# The application imports private.pem into its encrypted SQLite secret store at
# startup. These host files are runtime material for native Veyon compatibility,
# not RoomGoblin's configuration authority.
exit 0
