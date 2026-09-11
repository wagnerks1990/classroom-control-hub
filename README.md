# RoomGoblin

**Classroom & Lab Management Hub**  
*Run the room. Manage the lab.*

RoomGoblin is the branded successor to Classroom Control Hub. The product name, operator interface, setup experience, device-facing presentation, and documentation use **RoomGoblin**. Compatibility-sensitive internal identifiers from earlier releases are intentionally retained until an explicit migration is tested and documented.

## Compatibility contract

Existing installations must continue to work through the rebrand. The following legacy identifiers may remain in commands, paths, package IDs, service names, sockets, environment variables, container/image names, persisted data, and API contracts:

- `/opt/classroom-hub`
- `CLASSROOM_HUB_*`
- `org.roomgoblin.display`
- `classroom-control-hub*` systemd, socket, container, and GHCR identifiers
- existing setup/browser storage keys, database identifiers, device enrollment IDs, and public API names

Do not rename these merely for cosmetic consistency. A future internal-identifier migration must provide upgrade, rollback, data-preservation, and device-compatibility tests first. See [`docs/ROOMGOBLIN-REBRAND.md`](docs/ROOMGOBLIN-REBRAND.md) and [`docs/brand/BRAND-GUIDE.md`](docs/brand/BRAND-GUIDE.md).

## Host-network deployment contract

The Linux RoomGoblin appliance and maintenance containers, plus reviewed managed add-on templates, use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](docs/HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

> **Status:** `1.0.0-alpha.77` — alpha software. The RoomGoblin rebrand is being integrated without breaking the deployed appliance contract.

## What it does

RoomGoblin provides a single web controller for classroom and lab operations, including:

- stable URL browser displays with optional individually enrolled credentials and digital signage
- scheduled classroom automations
- priority live/morning announcements
- Background Music through Music Assistant
- AV routing and TV control integrations
- lighting integrations through MQTT
- class schedules, cycle days, closures, delays, half-days, and remote-day rules
- lab/client management integrations
- appliance-wide Docker inventory/lifecycle controls
- optional managed integration deployment/adoption
- diagnostics, backup/recovery, and host-management tooling

## Architecture

```text
Ubuntu host
├── /opt/classroom-hub                    # legacy-compatible install path
├── classroom-hub-host-agent.service      # legacy-compatible service name
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The application and maintenance service run in containers. Host-level operations are delegated to a narrow authenticated systemd Host Agent instead of giving the main application broad host privileges.

### Appliance control plane

The controller inventories Docker containers already present on the appliance and can perform authenticated lifecycle/diagnostic operations on discovered containers. Existing containers can be adopted without recreation.

First-class optional add-ons can also be deployed/recreated from Setup or Infrastructure & Recovery using reviewed image repositories:

```text
mosquitto                 eclipse-mosquitto:2.0.22
govee2mqtt                ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72
music-assistant-server     ghcr.io/music-assistant/server:2.9.13
```

Native `veyon.service` and `veyon-webapi.service` remain host-managed rather than being deployed as a proxy container. Persistent add-on state remains under the managed services root rather than container writable layers. Removing/recreating a supported add-on preserves its managed data directory.

This is intentionally **not** an unrestricted root Docker-command API: new container creation stays restricted to reviewed supported integration images, while existing containers can be discovered/adopted for safe appliance administration.

### Temporary HTTP-only deployment

The current appliance exposes RoomGoblin directly on HTTP:

```text
http://APPLIANCE-IP:3000/controller/
```

Default network settings remain:

```text
HUB_BIND_ADDRESS=0.0.0.0
HUB_PORT=3000
TRUST_PROXY_HOPS=0
```

The previous Caddy/HTTPS gateway has been removed for now. HTTPS will be reintroduced later as a separately reviewed feature after the base deployment/update path is stable. Until then, restrict port 3000 to a trusted classroom/admin network and do not expose the appliance directly to the public Internet.

## One-command appliance install

On a clean Ubuntu Server 24.04 LTS machine, download and run the reviewed bootstrap:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/classroom-control-hub/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

The repository and bootstrap filename intentionally remain legacy-compatible for existing automation. The bootstrap installs Docker Engine and Compose from Docker's signed package repository, clones the application into `/opt/classroom-hub`, generates unique appliance credentials, installs the native Host Agent, starts the containers, verifies component health, and prints the first-time setup URL. Review the downloaded script before running it on a production machine.

Use the web controller for routine upgrades and rollback after initial installation. The bootstrap refuses to overwrite an existing installation unless `CLASSROOM_HUB_REINSTALL=true` is explicitly supplied.

## Production updates

The standard production checkout remains `/opt/classroom-hub`. Production updates are Git-first:

```bash
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

For a development rebuild after the installer has established host permissions and secrets:

```bash
docker compose build --no-cache
docker compose up -d --remove-orphans
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

`--remove-orphans` removes the legacy TLS gateway when upgrading from a release that still included it.

Back up production state before upgrades and never overwrite the local `.env`, database, data, uploads, backups, or secrets with repository examples.

## Alpha.71 recovery changes

Alpha.71 includes the live-test fixes found while recovering alpha.70:

- installer takes SQLite-safe snapshots of every `data/*.db` before migration;
- an explicitly configured active database is preserved and database filename reconciliation is verified before container recreation;
- built-in access profiles with missing/empty capability arrays are repaired at startup without overwriting valid custom capability lists;
- Administrator remains `capabilities:["*"]`;
- punctuation-heavy passwords are regression-tested through setup/login/scrypt paths;
- maintenance startup health checks the Host Agent directly instead of waiting on the main application;
- missing maintenance secrets, old master-key location, and shared data-root ownership are reconciled by the installer;
- setup receiver IDs remain editable, duplicate IDs are rejected, and display groups are pruned when receivers are removed;
- existing supported integration containers can be adopted without recreation.

## Development deployment

```bash
sudo bash install.sh
```

The installer is required even for a first local appliance deployment because it creates unique credentials, persistent-directory ownership, secret mount files, the native Host Agent, and updater units. Running a raw `docker compose up` from a clean clone is not the supported installation path.

Then open:

```text
http://SERVER-IP:3000/controller/
```

## Persistent data

Runtime state must remain outside the container image. The default Compose configuration stores persistent application data in `./data` and keeps site-specific secrets in `.env`, mounted secret files, or encrypted application storage.

The shared data root uses a deliberate ownership model so both the non-root application and hardened maintenance service can operate:

```text
/opt/classroom-hub/data          root:10001 0770
/opt/classroom-hub/data/backups  root:10001 0700
```

Application-owned files remain `10001:10001`.

The master encryption key remains stored at `/etc/classroom-control-hub/master.key`. Upgrades from older releases preserve the previous `/etc/classroom-hub/master.key` when present.

Never commit production `.env` files, databases, API tokens, private keys, backups, or site-specific secrets.

## Site configuration and branding

The public repository intentionally does **not** include a specific school's internal IP addresses, calendars, credentials, stream URLs, or classroom hardware mappings. Configure school schedules, integrations, devices, and optional site branding in the controller; deployment secrets and bootstrap connection fallbacks remain in protected environment or secret files.

RoomGoblin's built-in identity is defined by the supplied Brand Package v1. The canonical product name is **RoomGoblin**, descriptor **Classroom & Lab Management Hub**, and tagline **Run the room. Manage the lab.** Built-in UI colors and artwork live under `public/brand/`, with authoritative design/AI rules under `docs/brand/` and `design/`.

Important optional settings include:

- `MORNING_ANNOUNCEMENTS_URL`
- `MUSIC_ASSISTANT_URL`
- `MQTT_URL`
- `PLUTO_URL`
- `VEYON_WEBAPI_URL`
- `VEYON_SCAN_SUBNET`

See `.env.example`, `INSTALL.md`, and `docs/CONFIGURATION.md`.

## Windows lab agents

Because the appliance is temporarily HTTP-only, Windows lab-agent enrollment requires the explicit `-AllowHttp` switch and should be limited to trusted classroom/admin networks.

```powershell
.\Install-Agent.ps1 -HubUrl http://SERVER-IP:3000 -AllowHttp
```

Legacy agent filenames, scheduled-task identifiers, and enrollment contracts are retained where changing them would break upgrades. User-facing descriptions should say **RoomGoblin Lab Agent**.

## Documentation

Start with:

- [`INSTALL.md`](INSTALL.md) — install/migration quick guide
- [`GITHUB-MIGRATION.md`](GITHUB-MIGRATION.md) — Git migration and update workflow
- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — current HTTP-only deployment model
- [`docs/ROOMGOBLIN-REBRAND.md`](docs/ROOMGOBLIN-REBRAND.md) — rebrand scope and compatibility contract
- [`docs/brand/BRAND-GUIDE.md`](docs/brand/BRAND-GUIDE.md) — authoritative visual and verbal identity
- [`docs/brand/AI-BRAND-CONTEXT.md`](docs/brand/AI-BRAND-CONTEXT.md) — machine/assistant branding rules
- [`docs/AI-CONTEXT.md`](docs/AI-CONTEXT.md) — compact technical context for AI assistants
- [`AGENTS.md`](AGENTS.md) — authoritative contributor/AI operating contract
- [`wiki/`](wiki/) — Git-tracked mirror of the GitHub Wiki

## AI-assisted development

AI coding assistants should read `AGENTS.md`, `docs/AI-CONTEXT.md`, and `docs/brand/AI-BRAND-CONTEXT.md` before modifying the project. **RoomGoblin** is the canonical product name. Old Classroom Control Hub/Classroom Hub strings are acceptable only for historical explanation or compatibility-sensitive identifiers that have not yet been migrated.

Project-critical invariants include Morning Announcements priority/recovery, explicitly linked class continuations, Background Music recovery, version convergence, independent integration health, database identity preservation, access-profile integrity, managed integration data preservation, device enrollment continuity, and the current rule that TLS/Caddy must not become a deployment health dependency until HTTPS is intentionally reintroduced.

## Container images

Existing deployments currently use these GHCR image identifiers:

```text
ghcr.io/wagnerks1990/roomgoblin
ghcr.io/wagnerks1990/roomgoblin-maintenance
```

The `alpha` tag tracks alpha builds. `latest` is intentionally reserved for a future stable RoomGoblin release. The image identifiers remain intentionally unchanged during the compatibility-safe brand transition. A future image rename requires dual-publish/migration support rather than silently abandoning the existing image names.

## Project maturity

RoomGoblin is currently alpha software. Production deployments should pin a specific version or known-good commit and maintain backups before upgrades.

## License

RoomGoblin is open-source software licensed under the [MIT License](LICENSE). You may use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software subject to the MIT License terms and preservation of the required copyright and license notice.

Copyright © 2026 [Kyle Wagner](https://github.com/wagnerks1990).
