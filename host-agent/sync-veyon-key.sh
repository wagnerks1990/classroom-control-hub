#!/usr/bin/env bash
set -euo pipefail

KEY_NAME="${VEYON_KEY_NAME:-master}"
TARGET_DIR="/etc/classroom-control-hub/veyon"
PRIVATE_TARGET="$TARGET_DIR/private.pem"
PUBLIC_TARGET="$TARGET_DIR/public.pem"
APP_GID="${APP_GID:-10001}"

command -v veyon-cli >/dev/null 2>&1 || exit 0

# Veyon key names are alphabetic. Reject unexpected values before using the name
# in CLI arguments or a table-match expression.
[[ "$KEY_NAME" =~ ^[A-Za-z]+$ ]] || { echo "Invalid VEYON_KEY_NAME: $KEY_NAME" >&2; exit 1; }

# Only synchronize when the requested private key actually exists. The Hub never
# creates or rotates native Veyon authentication keys implicitly.
if ! veyon-cli authkeys list details 2>/dev/null | grep -Eq "^\|[[:space:]]*${KEY_NAME}[[:space:]]*\|[[:space:]]*private[[:space:]]*\|"; then
  exit 0
fi

install -d -m 0750 "$TARGET_DIR"
chown root:"$APP_GID" "$TARGET_DIR" 2>/dev/null || chown root:root "$TARGET_DIR"

private_tmp="$(mktemp "$TARGET_DIR/.private.XXXXXX")"
public_tmp="$(mktemp "$TARGET_DIR/.public.XXXXXX")"
cleanup(){ rm -f "$private_tmp" "$public_tmp"; }
trap cleanup EXIT

veyon-cli authkeys export "$KEY_NAME/private" "$private_tmp" >/dev/null
veyon-cli authkeys extract "$KEY_NAME" >/dev/null
veyon-cli authkeys export "$KEY_NAME/public" "$public_tmp" >/dev/null

[[ -s "$private_tmp" ]] || { echo "Veyon private-key export was empty" >&2; exit 1; }
[[ -s "$public_tmp" ]] || { echo "Veyon public-key export was empty" >&2; exit 1; }

chmod 0640 "$private_tmp"
chmod 0644 "$public_tmp"
chown root:"$APP_GID" "$private_tmp" 2>/dev/null || chown root:root "$private_tmp"
chown root:root "$public_tmp"

mv -f "$private_tmp" "$PRIVATE_TARGET"
mv -f "$public_tmp" "$PUBLIC_TARGET"
trap - EXIT

# The application imports private.pem into its encrypted SQLite secret store at
# startup. These host files are runtime material for native Veyon compatibility,
# not Classroom Control Hub's configuration authority.
exit 0
