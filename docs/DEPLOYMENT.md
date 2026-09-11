# Deployment

## Host-network deployment contract

The Linux RoomGoblin and maintenance containers, plus reviewed managed add-on templates, use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

## Current deployment model

RoomGoblin currently runs as a direct HTTP appliance. HTTPS/TLS and the previous Caddy gateway are intentionally deferred while the deployment/update path is stabilized.

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker Engine
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The main application binds host TCP port `3000` directly (no Docker port publishing). The default is:

```text
HUB_BIND_ADDRESS=0.0.0.0
HUB_PORT=3000
TRUST_PROXY_HOPS=0
```

Use the appliance only on a trusted classroom/admin LAN or behind network controls that restrict access. Do not expose this HTTP-only deployment directly to the public Internet.

## Requirements

Recommended baseline:

- Ubuntu Server 24.04 LTS on validated `amd64` hardware (`arm64` is not yet supported);
- Docker Engine and Docker Compose v2;
- persistent local storage for SQLite, uploads, backups, and runtime state;
- reliable LAN connectivity to controlled classroom devices and integrations;
- host firewall/network segmentation appropriate for a temporary HTTP-only controller.

## Persistent state and permissions

The standard production checkout is `/opt/classroom-hub`.

```text
/opt/classroom-hub/
├── .env
├── docker-compose.yml
├── data/
│   ├── classroom-control-hub.db
│   └── backups/
└── config/
```

Runtime state must survive source updates.

The shared `data/` root is root-owned with group `10001` access so both hardened containers can traverse it:

```text
/opt/classroom-hub/data          root:10001 0770
/opt/classroom-hub/data/backups  root:10001 0700
```

Application-owned data files are UID/GID `10001:10001`.

The encryption key is stored outside the checkout at:

```text
/etc/classroom-control-hub/master.key
```

Upgrades from older installations must preserve `/etc/classroom-hub/master.key` if it already exists rather than silently rotating the key.

## First deployment

For a clean supported server:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/RoomGoblin/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

The HTTPS above is only for securely retrieving the installer from GitHub. The installed RoomGoblin service itself currently uses HTTP.

For a manual deployment:

```bash
sudo git clone https://github.com/wagnerks1990/RoomGoblin.git /opt/classroom-hub
cd /opt/classroom-hub
sudo cp .env.example .env
sudo bash install.sh
```

The installer:

1. creates a pre-migration backup when an existing installation is detected;
2. preserves runtime data and site configuration;
3. ensures non-empty setup/control/display/lab/maintenance tokens;
4. preserves or creates the master encryption key;
5. installs/restarts the native Host Agent;
6. fixes the shared data-directory ownership model;
7. removes obsolete TLS environment settings and the legacy Caddy container;
8. pulls the exact commit-matched images already built and validated by GitHub Actions, then starts maintenance plus the main HTTP application;
9. verifies backend, maintenance, and Host Agent version convergence.

Production installation does not compile application or Android dependencies on
the appliance. Deliberate developer testing may opt in with `sudo bash install.sh
--build-local`; this mode requires the appliance network to reach all locked build
dependencies and must not be used as the normal production update path.

## Access

After installation, use:

```text
http://APPLIANCE-IP:3000/controller/
```

First-time setup uses:

```text
http://APPLIANCE-IP:3000/setup/#token=...
```

Treat the setup URL as an administrator secret. It becomes unusable after initial administrator creation.

## Verification

Run:

```bash
cd /opt/classroom-hub
sudo docker compose ps
curl -fsS http://127.0.0.1:3000/health | jq
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock
```

Expected Compose services:

```text
classroom-control-hub
classroom-control-hub-maintenance
```

There should be no `classroom-control-hub-tls`/Caddy service in the current architecture.

Confirm that:

- the application health endpoint returns `ok:true` and `ready:true`;
- database and scheduler checks are healthy;
- the main application and maintenance container are healthy;
- the Host Agent is running the same application version;
- `MAINTENANCE_TOKEN` is non-empty and consistent across Host Agent, application, and maintenance container;
- the SQLite database is writable by UID/GID `10001`;
- the controller is reachable from the trusted LAN on port 3000;
- configured displays and integrations reconnect.

## Firewall guidance

Because the controller currently uses HTTP, restrict port 3000 to trusted classroom/admin networks. Example with UFW, replacing the subnet as appropriate:

```bash
sudo ufw allow from 192.0.2.0/24 to any port 3000 proto tcp
```

Do not expose the maintenance service or Host Agent socket externally.

## Windows lab agents

The Windows lab-agent installer keeps an explicit `-AllowHttp` acknowledgement while TLS is deferred. This prevents accidental enrollment over an untrusted network.

Example:

```powershell
.\Install-Agent.ps1 -HubUrl http://192.0.2.10:3000 -AllowHttp
```

See `docs/LAB-AGENT.md` and `wiki/Windows-Lab-Agent.md`.

## Git-first upgrade procedure

Before a production update, retain a recovery snapshot and database-safe backup.

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-before-update-$(date +%Y%m%d-%H%M%S)"
```

Then:

```bash
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

For development rebuilds after the installer has established permissions/secrets:

```bash
sudo docker compose build
sudo docker compose up -d --remove-orphans
curl -fsS http://127.0.0.1:3000/health
```

`--remove-orphans` is important when upgrading from a release that contained the old Caddy service.

## Web-managed release updates

The web-managed updater accepts verified semantic-version GitHub releases and delegates host-level work to `classroom-hub-app-update.service`.

A successful update currently requires:

- backend HTTP health;
- maintenance health;
- native Host Agent health;
- application/maintenance/Host Agent version convergence;
- database/scheduler readiness.

TLS/Caddy is not a release-health dependency while HTTPS is deferred.

The updater must also ensure the runtime filesystem layout and a non-empty `MAINTENANCE_TOKEN` before recreating containers. Failed updates restore the previous source/images and matching operational backup.

## Rollback

Rollback replaces application source/images while preserving the matching runtime state. If a database migration is not backward compatible, restore the matching pre-upgrade database backup before starting the older release.

Keep at least one known-good snapshot until the new release has been verified in the classroom.

## Reintroducing HTTPS later

HTTPS should return as a deliberate separate feature after the HTTP-only appliance path is stable. Requirements for that future work include:

- no circular Compose health dependency;
- DNS/SNI behavior tested with real classroom clients;
- certificate distribution/trust strategy documented;
- HTTP-to-HTTPS migration that does not strand existing installations;
- reverse-proxy-aware `TRUST_PROXY_HOPS` configuration;
- upgrade/rollback tests from the HTTP-only release;
- no hard dependency on the proxy for maintenance or Host Agent health.

Do not restore Caddy/TLS piecemeal through environment variables or ad-hoc Compose edits.

## Backup policy

Back up at minimum:

- the SQLite database and WAL-related state using a database-safe mechanism;
- uploaded/media files;
- site configuration;
- the master encryption key;
- `.env` in a protected backup location;
- pre-upgrade recovery snapshots.

Never commit production backups or secrets to the public repository.

Configuration, operational, data, and full recovery archives can contain site
configuration, internal addresses, device inventory, user/student records,
media, or secrets. Store them as sensitive administrative data and require the
controller's explicit sensitive-data confirmation before creation. Full backups
also require the separate secrets confirmation.

The **diagnostic** scope is the only archive intended for a support case. It is
metadata-only and excludes the SQLite database, runtime data, managed-service
state, device inventory, ADB identity, student records, `.env`, certificates,
and keys. Still inspect its contents before sharing it outside the organization.
