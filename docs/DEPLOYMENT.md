# Deployment

## Recommended production model

Classroom Control Hub is intended to run primarily in Docker, with host-only operations delegated to a narrow systemd host agent.

```text
Ubuntu host
├── classroom-control-hub-host-agent.service
└── Docker Engine
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

## Requirements

Recommended baseline:

- Ubuntu Server 24.04 LTS or another current Linux distribution capable of running Docker Engine;
- Docker Engine and Docker Compose v2;
- persistent local storage for the SQLite database, uploads, backups, and runtime configuration;
- reliable LAN connectivity to controlled classroom devices and integrations;
- a reverse proxy and TLS when the controller is accessed outside a trusted management network.

## Persistent directories

Do not place production state only inside a container writable layer. A typical deployment should persist:

```text
/opt/classroom-control-hub/
├── .env
├── docker-compose.yml
├── data/
├── uploads/
├── backups/
└── secrets/
```

The exact volume mapping is defined by `docker-compose.yml`.

## First deployment

Clone the repository into a staging directory first:

```bash
git clone https://github.com/wagnerks1990/classroom-control-hub.git
cd classroom-control-hub
cp .env.example .env
```

Review every value in `.env` before starting production services.

For source-build deployments:

```bash
docker compose build
docker compose up -d
```

Once versioned GHCR images are published, production deployment should prefer image pulls rather than rebuilding on the classroom host:

```bash
docker compose pull
docker compose up -d
```

## Verification

After startup:

```bash
docker compose ps
curl -fsS http://localhost:3000/health
```

Confirm that:

- the reported application version is the expected release;
- the database path is on persistent storage;
- controller authentication is configured before exposing the application broadly;
- configured display clients reconnect;
- integrations report expected health without exposing credentials in logs.

## Reverse proxy

The reverse proxy should terminate TLS and forward WebSocket traffic correctly. Display/control channels depend on long-lived connections, so proxy configuration must support WebSocket upgrade headers and suitable timeouts.

Do not expose maintenance or host-agent endpoints publicly unless explicitly required and protected.

## Host Agent

The host agent should be installed directly on the host and run under systemd. See [HOST-AGENT.md](HOST-AGENT.md).

Keep its interface bound to the intended management network or localhost/reverse-proxy path and use authentication. Do not replace this boundary by granting the main application container unrestricted host privileges.

## Upgrade procedure

Before any production upgrade:

```bash
cd /opt/classroom-control-hub
cp -a data "backups/data-pre-upgrade-$(date +%Y%m%d-%H%M%S)"
```

If using published images:

```bash
docker compose pull
docker compose up -d
```

Then verify:

```bash
docker compose ps
curl -fsS http://localhost:3000/health
```

Review logs:

```bash
docker compose logs --tail=150
```

## Rollback

A rollback should change only replaceable application containers/images while preserving the existing persistent data unless a documented database migration requires a coordinated database restore.

Typical image rollback:

```bash
# Pin compose image tags to the previous known-good release,
# then recreate containers.
docker compose pull
docker compose up -d
```

If a database migration is not backward compatible, stop services and restore the matching pre-upgrade backup before starting the older release.

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
- semantic version tags such as `:1.0.0-alpha.63`;
- `:latest` — stable releases only.

Do not point `latest` at experimental alpha builds.
