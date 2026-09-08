#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_URL="${CLASSROOM_HUB_REPOSITORY_URL:-https://github.com/wagnerks1990/classroom-control-hub.git}"
REPOSITORY_REF="${CLASSROOM_HUB_REF:-main}"
TARGET="${CLASSROOM_HUB_DIR:-/opt/classroom-hub}"
SERVICES="${CLASSROOM_HUB_SERVICES_DIR:-/opt/services}"
BACKUPS="${CLASSROOM_HUB_BACKUP_DIR:-/opt/classroom-hub-backups}"
STAGE=""

fail(){ echo "Classroom Control Hub bootstrap failed: $*" >&2; exit 1; }
cleanup(){ if [[ -n "$STAGE" && -d "$STAGE" ]]; then rm -rf -- "$STAGE"; fi; }
trap cleanup EXIT

[[ $EUID -eq 0 ]] || fail "run with sudo or as root"
[[ -r /etc/os-release ]] || fail "cannot identify the operating system"
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  [[ "${CLASSROOM_HUB_ALLOW_UNSUPPORTED_OS:-false}" == "true" ]] || fail "Ubuntu Server 24.04 LTS is the supported appliance platform (detected ${PRETTY_NAME:-unknown})"
fi
[[ "$TARGET" == /* && "$TARGET" != "/" ]] || fail "CLASSROOM_HUB_DIR must be an absolute non-root path"
[[ ! -L "$TARGET" ]] || fail "CLASSROOM_HUB_DIR may not be a symbolic link"
[[ "$TARGET" =~ ^/opt/[A-Za-z0-9._/-]+$ ]] || fail "CLASSROOM_HUB_DIR contains unsupported path characters"
TARGET_REAL="$(readlink -m "$TARGET")"
case "$TARGET_REAL" in /|/opt|/usr|/var|/etc|/home|/root|/tmp) fail "CLASSROOM_HUB_DIR resolves to unsafe broad path $TARGET_REAL";; esac
[[ "$TARGET_REAL" == /opt/* ]] || fail "CLASSROOM_HUB_DIR must resolve beneath /opt"
[[ "$REPOSITORY_REF" =~ ^[A-Za-z0-9._/-]{1,160}$ ]] || fail "CLASSROOM_HUB_REF contains unsupported characters"
if [[ -d "$TARGET_REAL" ]] && find "$TARGET_REAL" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  [[ "${CLASSROOM_HUB_REINSTALL:-false}" == "true" ]] || fail "the target $TARGET is not empty; use the web updater for an existing appliance, choose another target, or set CLASSROOM_HUB_REINSTALL=true for a deliberate installer rerun"
  [[ -f "$TARGET_REAL/.classroom-hub-installation" || ( -f "$TARGET_REAL/docker-compose.yml" && -f "$TARGET_REAL/VERSION" ) ]] || fail "refusing to reinstall into an unrecognized directory"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg openssl python3 rsync unzip zip

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Installing Docker Engine and the Compose plugin from Docker's signed apt repository ..."
  install -m 0755 -d /etc/apt/keyrings
  curl --proto '=https' --tlsv1.2 -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"
  case "$ARCH" in amd64|arm64) ;; *) fail "unsupported CPU architecture: $ARCH" ;; esac
  CODENAME="${VERSION_CODENAME:-noble}"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' "$ARCH" "$ID" "$CODENAME" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker.service
docker info >/dev/null
docker compose version >/dev/null

STAGE="$(mktemp -d /tmp/classroom-control-hub-bootstrap.XXXXXX)"
echo "Downloading Classroom Control Hub ${REPOSITORY_REF} ..."
git clone --filter=blob:none --branch "$REPOSITORY_REF" --single-branch "$REPOSITORY_URL" "$STAGE/source"

echo "Installing the classroom appliance into $TARGET ..."
CLASSROOM_HUB_DIR="$TARGET" CLASSROOM_HUB_SERVICES_DIR="$SERVICES" CLASSROOM_HUB_BACKUP_DIR="$BACKUPS" bash "$STAGE/source/install.sh"

echo
echo "One-command appliance deployment completed."
echo "Repository: $REPOSITORY_URL"
echo "Source ref: $REPOSITORY_REF"
echo "Installation: $TARGET"
echo "Services: $SERVICES"
echo "Migration backups: $BACKUPS"
