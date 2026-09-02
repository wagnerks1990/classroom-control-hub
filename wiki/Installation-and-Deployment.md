# Installation and Deployment

## Recommended production layout

Classroom Control Hub is intended to run primarily through Docker Compose, with the host agent installed separately on the Ubuntu host when host-level functions are required.

```text
Ubuntu host
├── classroom-control-hub-host-agent.service
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

## Prerequisites

Recommended baseline:

- Ubuntu Server 24.04 LTS or a comparable modern Linux host
- Docker Engine with Docker Compose v2
- Git
- persistent storage for application data and backups
- a reverse proxy if the controller is exposed outside the local management network

## Clone-based development installation

```bash
git clone https://github.com/wagnerks1990/classroom-control-hub.git
cd classroom-control-hub
cp .env.example .env
```

Edit `.env` before starting the application. Never commit the populated `.env` file.

For source builds:

```bash
docker compose build
docker compose up -d
```

Verify:

```bash
docker compose ps
curl -s http://localhost:3000/health
```

## Container-image deployment

The long-term deployment model is GitHub Container Registry (GHCR). Once alpha images are published, Compose should reference versioned or channel tags instead of requiring a local build.

Example update cycle:

```bash
cd /opt/classroom-control-hub
docker compose pull
docker compose up -d
```

Persistent data must live in mounted volumes/directories so replacing the container does not erase the database, configuration, media, or backups.

## Existing installation migration

Do not replace a working `/opt/classroom-hub` installation until the GitHub/Docker build has been validated against a copy of the existing persistent data.

Recommended migration process:

1. Back up the existing installation and SQLite database.
2. Deploy the GitHub version into a separate directory.
3. Copy only approved runtime configuration and persistent data into the new layout.
4. Start the new deployment on alternate ports.
5. Validate controller, displays, automations, Morning Announcements, Background Music, class schedule rules, and integrations.
6. Cut over the reverse proxy only after validation.
7. Retain the previous installation until rollback is no longer required.

## Host agent

Host-level operations should run through the host agent rather than granting the main container unrestricted Docker socket or host filesystem access.

See the repository's `docs/HOST-AGENT.md` for the current host-agent documentation.

## Reverse proxy

The controller should normally remain behind an authenticated reverse proxy or trusted management network. WebSocket support must be enabled because display clients and other real-time functions rely on persistent connections.

## Backups before upgrades

Before any production upgrade, preserve at minimum:

- SQLite database/runtime data
- `.env` and site configuration
- uploaded media/assets
- integration configuration
- backups that have not yet been copied off-host

Container images and source code are replaceable. Runtime state is not.
