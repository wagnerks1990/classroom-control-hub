# Deployment

## Recommended production model

Classroom Control Hub is intended to run primarily in Docker, with host-only operations delegated to a narrow systemd host agent.

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker Engine
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

## Requirements

Recommended baseline:

- Ubuntu Server 24.04 LTS on `amd64` or `arm64` for the supported automatic bootstrap;
- Docker Engine and Docker Compose v2, installed automatically by the bootstrap or supplied in advance for manual installation;
- persistent local storage for the SQLite database, uploads, backups, and runtime configuration;
- reliable LAN connectivity to controlled classroom devices and integrations;
- a reverse proxy and TLS when the controller is accessed outside a trusted management network.

## Persistent directories

Do not place production state only inside a container writable layer. The standard production checkout is:

```text
/opt/classroom-hub/
├── .env
├── docker-compose.yml
├── data/
├── uploads/
├── backups/
└── secrets/
```

Site-specific runtime data must survive source updates. The exact volume mapping is defined by `docker-compose.yml`.

## First deployment

For a clean supported server, download, review, and run the appliance bootstrap:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/classroom-control-hub/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

The bootstrap installs Docker from its signed apt repository, downloads the selected repository ref into a temporary staging directory, generates independent appliance secrets, invokes the production installer, verifies health/version convergence, and prints the token-bearing first-time setup URL. It refuses to overwrite an established appliance by default.

For a manual or migration deployment, clone into the standard path:

```bash
sudo git clone https://github.com/wagnerks1990/classroom-control-hub.git /opt/classroom-hub
cd /opt/classroom-hub
sudo cp .env.example .env
```

Review every value in `.env` before starting production services. Do not commit the production `.env`.
Set `HUB_TLS_HOST` to the DNS name or IP used by classroom browsers. The installer does this automatically for a fresh appliance using its primary IP.

The supported installer path is:

```bash
sudo bash install.sh
```

After the installer has created credentials, persistent-path ownership, secret
mounts, and native services, Compose can be used for development rebuilds:

```bash
sudo bash install.sh
sudo docker compose build
sudo docker compose up -d
```

## Verification

After startup:

```bash
sudo docker compose ps
curl -fsS http://localhost:3000/health
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

The application backend is deliberately bound to `127.0.0.1:3000`; normal LAN access uses `https://HUB_TLS_HOST/`. Caddy creates an appliance-owned local CA. Export its root certificate for managed-device trust deployment with:

```bash
sudo docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./classroom-hub-root-ca.crt
```

Confirm that:

- the reported application version is the expected release;
- backend, controller/display, maintenance, and host-agent versions are converged;
- the database path is on persistent storage;
- controller authentication is configured before exposing the application broadly;
- configured display clients reconnect;
- the Host Agent socket is visible both on the host and in the maintenance container;
- integrations report their own health independently without exposing credentials in logs.

## Reverse proxy

The reverse proxy should terminate TLS and forward WebSocket traffic correctly. Display/control channels depend on long-lived connections, so proxy configuration must support WebSocket upgrade headers and suitable timeouts.

Do not expose maintenance or host-agent endpoints publicly.

## Host Agent

The host agent runs directly on the host under systemd. It communicates with the maintenance container only through `/run/classroom-control-hub/host-agent.sock`.

See [HOST-AGENT.md](HOST-AGENT.md).

## Git-first upgrade procedure

Before any production upgrade, take a backup appropriate to the application/database state. A simple filesystem snapshot of the installation is useful in addition to database-safe backups:

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-before-update-$(date +%Y%m%d-%H%M%S)"
```

Then update source:

```bash
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
```

Build and recreate:

```bash
sudo docker compose build --no-cache
sudo docker compose up -d
```

Verify:

```bash
sudo docker compose ps
curl -fsS http://localhost:3000/health
sudo docker compose logs --tail=150
```

Do not replace tracked source by unpacking a release ZIP over a Git checkout unless a documented recovery procedure explicitly requires it.

## Integration health and UI responsiveness

Optional or slow hardware integrations must not block the initial Overview screen. The UI should render lightweight application/device/schedule state first and refresh slow hardware status asynchronously.

Integration health is independent. For example, a Pluto error must not make MQTT/Govee appear offline.

## Rollback

A rollback should replace application source/images while preserving the matching persistent state. If a database migration is not backward compatible, restore the matching pre-upgrade database backup before starting the older release.

Keep at least one known-good production snapshot until the new release has been verified in the classroom.

## Web-managed release updates

Infrastructure & Recovery can check a configurable GitHub `owner/repository` for
semantic-version releases. Alpha, beta, and stable channels are separated;
draft releases are never eligible. Private repositories require a read-only
GitHub token, which is encrypted in the application database and never returned
to the browser.

Manual installation and optional automatic installation use the native
`classroom-hub-app-update.service`. The native job survives container
replacement and performs `git fetch`, resolves the selected release tag to an
immutable commit that must be reachable from `origin/main`, rebuilds the
application services, discovers the published controller port from Compose,
and requires the backend, HTTPS gateway, maintenance service, and Host Agent to
be healthy and report the expected version. The configured
Git remote must be this project's public GitHub repository. A failure restores
the previous detached commit, exact saved container image IDs, and matching
pre-update operational backup. The
**Revert Last Upgrade** action performs the same process deliberately and first
backs up the current state. Administrators should not run the production
checkout as a long-lived local branch; update and rollback deliberately leave
it detached at a verified release commit.

Automatic installation is disabled by default. When enabled, checks and
installation occur only inside the configured maintenance window. The first
deployment that introduces this feature must run `sudo ./install.sh` once to
install the native application-update systemd unit.

Use the controller's **Clear stored GitHub token** action after changing a
private repository to public or when rotating credentials. The updater does not
need a token for this public repository. Clearing it removes the encrypted
database value; also revoke the old token at GitHub if it may have been exposed.

Custom appliance roots are supported beneath `/opt` by setting
`CLASSROOM_HUB_DIR`, `CLASSROOM_HUB_SERVICES_DIR`, and
`CLASSROOM_HUB_BACKUP_DIR` when running the bootstrap. The installer persists
their container-facing equivalents in `.env`; all three roots must be separate
and non-nested.

## Backup policy

Back up at minimum:

- SQLite database and WAL-related state using a database-safe backup mechanism;
- uploaded/media files;
- site configuration;
- encrypted secret-store master-key material;
- certificates required for recovery;
- deployment `.env` stored in a protected backup location.

Never commit these production backups to the public repository.

## Production release channels

Recommended tags:

- `:alpha` — current alpha channel;
- `:beta` — testing/pre-release channel when introduced;
- semantic version tags such as `:1.0.0-alpha.67`;
- `:latest` — stable releases only.

Do not point `latest` at experimental alpha builds.
