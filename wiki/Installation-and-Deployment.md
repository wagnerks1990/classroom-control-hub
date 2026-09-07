# Installation and Deployment

## Recommended production layout

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The standard production checkout is `/opt/classroom-hub`. Older references to `/opt/classroom-control-hub` are migration-era defaults unless a deployment intentionally chose a custom path.

## Prerequisites

Recommended baseline:

- Ubuntu Server 24.04 LTS or a comparable modern Linux host
- Docker Engine with Docker Compose v2
- Git
- persistent storage for application data and backups
- a reverse proxy if the controller is exposed outside the local management network

## Production installation

For a clean Ubuntu Server 24.04 LTS `amd64` or `arm64` host, Docker and the complete appliance can be installed with the reviewed bootstrap:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/classroom-control-hub/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

The bootstrap generates unique appliance credentials, verifies the running components, and prints the first-time administrator setup URL. It refuses to replace an existing deployment by default; use the controller's update/revert workflow for an installed appliance.

For manual installation or migration:

```bash
sudo git clone https://github.com/wagnerks1990/classroom-control-hub.git /opt/classroom-hub
cd /opt/classroom-hub
sudo cp .env.example .env
```

The installer fills blank appliance secrets automatically. Review other site values in `.env` before exposing the application. Never commit the populated `.env` file.

Then run:

```bash
sudo bash install.sh
```

The installer preserves runtime state during upgrades, installs/reconciles the native Host Agent, verifies the Unix socket, builds the containers, and checks component version convergence.

## Normal Git update cycle

The web controller can also perform release-tag updates after `sudo ./install.sh`
has installed `classroom-hub-app-update.service`. Its GitHub repository, release
channel, automatic-update choice, check interval, and maintenance window are
stored in the application database. Each update creates a recovery backup and
automatically returns to the previous commit and database/configuration state if
the new release does not pass health verification.

```bash
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
sudo docker compose build --no-cache
sudo docker compose up -d
sudo docker compose ps
curl -fsS http://localhost:3000/health
```

Take a backup before upgrading.

## Development installation

```bash
git clone https://github.com/wagnerks1990/classroom-control-hub.git
cd classroom-control-hub
cp .env.example .env
docker compose build
docker compose up -d
```

## Existing installation migration

Before converting an existing installation to Git:

1. Back up the current application tree and database.
2. Preserve `.env`, persistent data, media/uploads, backups, keys, and site configuration.
3. Clone the repository into the standard production path.
4. Restore only runtime state; do not copy legacy tracked source over the Git checkout.
5. Verify the Host Agent service uses `/opt/classroom-hub` and `/run/classroom-control-hub/host-agent.sock`.
6. Recreate the maintenance container and confirm it can see the Host Agent socket.
7. Validate controller, displays, automations, Morning Announcements, Background Music, class schedule rules, and integrations.
8. Retain a known-good rollback snapshot until the new deployment is verified.

## Host Agent verification

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock && echo "Host Agent socket OK"
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

## Integration configuration

The public repository intentionally contains generic defaults. After migration, restore local values such as MQTT, Pluto, Music Assistant, Veyon, stream URLs, device mappings, and school calendar configuration through `.env` or persistent runtime configuration.

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
