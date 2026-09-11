# Installation and Deployment

See [Host Networking](Host-Networking) for the current Linux container topology, loopback-only maintenance API, explicit add-on migration, listener ports and recovery rules.

## Current production layout

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The previous Caddy/TLS service has been removed for now. The current appliance exposes direct HTTP on port `3000` while HTTPS is redesigned.

```text
http://APPLIANCE-IP:3000/controller/
```

Default values:

```text
HUB_BIND_ADDRESS=0.0.0.0
HUB_PORT=3000
TRUST_PROXY_HOPS=0
```

Restrict the port to the trusted classroom/admin network and do not expose this temporary HTTP-only deployment directly to the public Internet.

The standard production checkout is `/opt/classroom-hub`. Older references to `/opt/classroom-control-hub` are migration-era defaults unless a deployment intentionally chose a custom path.

## Prerequisites

Recommended baseline:

- Ubuntu Server 24.04 LTS or a comparable modern Linux host
- Docker Engine with Docker Compose v2
- Git
- persistent storage for application data and backups
- trusted LAN/firewall controls for TCP/3000

## Production installation

For a clean Ubuntu Server 24.04 LTS `amd64` or `arm64` host:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/classroom-control-hub/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

The HTTPS command above is only for securely downloading the bootstrap from GitHub. The installed Hub currently uses HTTP.

The bootstrap generates unique appliance credentials, verifies the running components, and prints the first-time administrator setup URL. It refuses to replace an existing deployment by default; use the controller's update/revert workflow for an installed appliance.

Custom roots can be supplied when required; keep them separate and beneath `/opt`:

```bash
sudo CLASSROOM_HUB_DIR=/opt/classroom-hub \
  CLASSROOM_HUB_SERVICES_DIR=/opt/classroom-services \
  CLASSROOM_HUB_BACKUP_DIR=/opt/classroom-backups \
  bash /tmp/classroom-hub-bootstrap.sh
```

For manual installation or migration:

```bash
sudo git clone https://github.com/wagnerks1990/classroom-control-hub.git /opt/classroom-hub
cd /opt/classroom-hub
sudo cp .env.example .env
sudo bash install.sh
```

The supported production installer pulls the exact `sha-<commit>` main and
maintenance images published after GitHub validation. It does not compile Gradle,
JitPack, or Node dependencies on the appliance. `sudo bash install.sh --build-local`
is an explicit development-only escape hatch.

The installer fills blank appliance secrets automatically, preserves the old master key when present, repairs the shared data-root ownership model, restarts the Host Agent, removes obsolete TLS settings/Caddy containers, starts the HTTP-only application, and verifies component convergence.

## Runtime filesystem invariants

Shared roots:

```text
/opt/classroom-hub/data          root:10001 0770
/opt/classroom-hub/data/backups  root:10001 0700
```

Application-owned files remain `10001:10001`.

Master key:

```text
/etc/classroom-control-hub/master.key
```

An older `/etc/classroom-hub/master.key` must be migrated instead of silently replaced.

## Normal Git update cycle

The web controller can perform release-tag updates after `sudo ./install.sh` has installed `classroom-hub-app-update.service`. Each update creates a recovery backup and automatically returns to the previous commit/state if the new release does not pass backend HTTP, maintenance, Host Agent, database/scheduler, and version-convergence checks.

Manual update:

```bash
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

Development rebuild after a valid install:

```bash
sudo docker compose build --no-cache
sudo docker compose up -d --remove-orphans
sudo docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

`--remove-orphans` removes the old TLS container when upgrading from a Caddy-based release.

## Existing installation migration

Before converting an existing installation to Git:

1. Back up the current application tree and database.
2. Preserve `.env`, persistent data, media/uploads, backups, keys, and site configuration.
3. Clone the repository into the standard production path.
4. Restore only runtime state; do not copy legacy tracked source over the Git checkout.
5. Verify the Host Agent service uses `/opt/classroom-hub` and `/run/classroom-control-hub/host-agent.sock`.
6. Ensure `MAINTENANCE_TOKEN` is non-empty before recreating maintenance.
7. Confirm the shared data-root ownership matches the documented root/group model.
8. Run `sudo bash install.sh` so obsolete Caddy/TLS state is removed safely.
9. Validate controller, displays, automations, Morning Announcements, Background Music, class schedule rules, and integrations.
10. Retain a known-good rollback snapshot until the new deployment is verified.

## Host Agent verification

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock && echo "Host Agent socket OK"
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

## Windows lab agents

During the HTTP-only phase, enrollment requires explicit acknowledgement:

```powershell
.\Install-Agent.ps1 -HubUrl http://APPLIANCE-IP:3000 -AllowHttp
```

Use this only on a trusted network.

## Integration configuration

The public repository intentionally contains generic defaults. After migration, configure MQTT/Govee, Pluto, Veyon, Music Assistant, stream URLs, device mappings, and school calendar rules through the controller. Existing `.env` integration values remain first-start/migration fallbacks; database values become authoritative after the corresponding GUI settings are saved.

Optional or slow integration probes must not delay the initial controller Overview screen, and one integration failure must not falsely mark another integration offline.

## Backups before upgrades

Preserve at minimum:

- SQLite database/runtime data
- `.env` and site configuration
- uploaded media/assets
- integration configuration
- master/private keys required for recovery
- off-host copies of important backups

Container images and tracked source are replaceable. Runtime state is not.

## HTTPS later

HTTPS should return only as a separately reviewed feature with DNS/SNI testing, client trust guidance, rollback coverage, and no circular health dependency. Do not reintroduce Caddy ad hoc through local Compose edits.
