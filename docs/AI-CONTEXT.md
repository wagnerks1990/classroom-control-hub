# AI Project Context

## Host-network deployment contract

The Linux Hub and maintenance containers, plus reviewed managed add-on templates, now use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

This document gives AI assistants a compact operational model of Classroom Control Hub. `AGENTS.md` is the primary contributor contract; this document expands the technical context.

## Purpose

Classroom Control Hub is a centralized classroom/lab control platform. It coordinates browser displays, scheduled automations, AV routing, lighting, Morning Announcements, Background Music, class schedules, school-cycle rules, Veyon lab management, diagnostics, backup/recovery, Docker integrations, Android/Google TV managed displays, and host-management functions.

Production installers and semantic-release updates pull exact CI-built GHCR
images. Do not reintroduce appliance-local builds as the default. Local compilation
is available only through the explicit `install.sh --build-local` development path.

## Runtime architecture

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker Engine
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The main application must not receive broad host privileges. Host-level operations are delegated through the maintenance service to the native Host Agent over the Unix socket.

### Appliance control plane

The controller is the appliance control plane. It inventories Docker containers already present on the host and may perform authenticated lifecycle/log/inspection operations on discovered containers. New container creation remains restricted to reviewed supported integration image repositories.

First-class optional managed add-ons are:

```text
mosquitto                 eclipse-mosquitto:2.0.22
govee2mqtt                ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72
music-assistant-server     ghcr.io/music-assistant/server:2.9.13
```

Setup and Infrastructure & Recovery expose these services. Existing containers should be **adopted without recreation** unless the administrator explicitly chooses deploy/recreate. Managed persistent data must live beneath the services root rather than container writable layers and should survive container removal/recreation.

The Host Agent extension may dynamically allow safe lifecycle/read operations for an existing discovered container, but `docker run` remains image-allowlisted. Do not replace this with an arbitrary root Docker command surface.

### Current network exposure

The appliance is intentionally **HTTP-only for the current development/live-test phase**. The main application publishes port `3000` directly, with `HUB_BIND_ADDRESS=0.0.0.0` by default so trusted classroom/admin LAN clients can reach it. Caddy and the built-in HTTPS/TLS gateway were removed after alpha.70 deployment failures and will be redesigned later.

Do not assume an HTTPS reverse proxy exists. Do not add Caddy/TLS dependencies, certificate checks, `HUB_TLS_HOST`, `HUB_HTTP_PORT`, or `HUB_HTTPS_PORT` back into deployment/update health gates unless HTTPS is being deliberately reintroduced as a separate reviewed feature. With no reverse proxy, `TRUST_PROXY_HOPS` defaults to `0`.

HTTP is a temporary trusted-network deployment mode. Avoid exposing the appliance directly to untrusted networks or the public Internet. Windows lab-agent HTTP enrollment keeps an explicit `-AllowHttp` acknowledgement until TLS returns.

## Persistent state

Treat these as runtime state, not replaceable source:

- `.env`
- `data/` and the SQLite database
- uploads/media/presentation data
- backups
- private keys and the master encryption key
- managed integration data beneath the services root
- site-specific hardware mappings and credentials
- Android/Google TV managed-device inventory, ADB keys, agent package and policy state beneath `data/android-tv/`

A Git update must preserve them.

The shared `data/` root is intentionally root-owned with group `10001` access so both the non-root application and hardened maintenance container can traverse it. Application-owned files remain UID/GID `10001:10001`; `data/backups` is maintained by the maintenance layer. Do not reintroduce code that chmods the entire shared data root to `0700`.

The current master key path is `/etc/classroom-control-hub/master.key`. Upgrades from older installations must preserve `/etc/classroom-hub/master.key` by migrating it rather than silently generating a replacement.

## Current known-good baseline

`1.0.0-alpha.74` is the current display-access and clean-worktree installer baseline.

Alpha.71 recovery invariants:

- Host Agent, maintenance, backend and stamped client versions converge;
- `MAINTENANCE_TOKEN` must be non-empty before container recreation;
- maintenance Compose health checks the Host Agent directly and does not wait on the main application;
- database and scheduler readiness must pass before an update is accepted;
- installer takes SQLite-safe backups of every `data/*.db` before migration;
- `DATABASE_FILE` is authoritative and must not silently switch to another existing database filename;
- built-in access profiles are repaired when their capability array is missing/empty; Administrator must resolve to `capabilities:["*"]`;
- password strings containing punctuation survive setup/login/scrypt verification;
- setup receiver IDs remain editable and display groups must be pruned to the saved receiver set;
- supported existing integration containers can be adopted without recreation;
- HTTP-only deployment must not regain a TLS-gateway dependency.

Verified classroom behaviors remain:

- HLS is the primary Morning Announcements live/offline signal for Ant Media player URLs.
- A valid HLS playlist is LIVE; a confirmed 404 is OFFLINE; transient network errors are not definitive offline evidence.
- Two consecutive OFFLINE checks are required before automatically ending active Morning Announcements.
- Announcement playback uses a locally controlled media element so volume/mute controls work.
- Morning Announcements are highest priority and pause Background Music.
- When announcements end, the scheduler performs a failsafe resync and re-runs the currently applicable winning display automations before Background Music resumes.
- Timer continuation is limited to an explicitly linked continuation of the same base class or period.

If `VERSION` is newer, use the newer release as the version source while retaining these invariants unless explicitly changed in the changelog.

## Database identity and migrations

Alpha.70 demonstrated that two valid-looking SQLite filenames can cause a successful container recreation to start against stale state. Never infer the active database solely from existence or file age when `.env` specifies `DATABASE_FILE`.

Before migration:

1. create SQLite-safe `.backup` copies for all database files;
2. stop the main application before replacing/canonicalizing an active database;
3. validate the destination with `PRAGMA quick_check`;
4. preserve the previous database file for rollback rather than deleting it;
5. update `.env` before recreating the application;
6. verify the live container's `DATABASE_FILE`, administrator account, scheduler and database health after restart.

Maintenance backup/restore and the application runtime must agree on database identity.

## Authentication and capability profiles

An explicitly assigned access profile is authoritative and fails closed. Missing/disabled profiles must not silently regain role-default permissions.

Startup recovery may restore the default capability array only when a built-in profile exists but has a missing/empty/invalid capability list. It must not overwrite a valid non-empty custom list.

Passwords are opaque application strings. Shell troubleshooting must use safe quoting/hidden input because characters such as `!` and `#` have shell meanings even though they are normal password characters to the browser/API/scrypt implementation.

## Setup wizard invariants

Stable receiver IDs are editable. The wizard validates uniqueness and uses the explicit receiver list rather than assuming `tv1..tvN`. When receivers are removed, every display group's member list must be filtered against the remaining devices before the configuration is saved.

Optional service discovery must distinguish these actions:

- **Adopt Existing** — persist/control an already running supported service without recreation.
- **Deploy/Install** — create a missing supported service using the reviewed template.
- **Recreate/Update** — explicit destructive container replacement while preserving managed data.

Do not show a button whose backend path intentionally rejects the same operation.

## Scheduler and automation model

School calendar state affects scheduled operations. No-school days suppress scheduled classroom operations. Remote days advance the cycle but suppress scheduled classroom operations while manual controls remain available. Delay and half-day rules affect schedule resolution.

Morning Announcements override conflicting display automation. On release, do not restore stale snapshots. Re-evaluate the current schedule and select the newest currently applicable automation for each display target.

Scheduler readiness validates stored class and automation data. Invalid class times such as an end time before the start time must be rejected or repaired before migration is committed; health diagnostics should identify invalid records rather than returning only a generic failure.

## Integration model

Major integrations include MQTT/Govee, Pluto Mark I, Music Assistant / Sendspin, Veyon, Ant Media / HLS, browser display clients, Android/Google TV managed displays, and the native Host Agent.

Integration health must be independent. A Pluto failure must not make MQTT/Govee appear offline. Optional/slow hardware probes should run asynchronously and must not block the Overview screen.

Music Assistant managed Docker deployment uses host networking so local multicast discovery works and keeps its persistent `/data` outside the container. Veyon WebAPI may be adopted as an existing container/service or deployed using the supported proxy template where appropriate.

## Android / Google TV managed-display invariants

The first physically validated target is the Onn 4K Streaming Device running Android 14, product `wayne`, build `UKRB.260113.075.A1`.

Preserve these invariants:

- Enrollment/pairing and assignment/configuration are separate workflows.
- Pair once to establish ADB trust and a stable managed-device ID; use Edit for school/building/room/profile/display URL changes.
- Display Agent package is `org.classroomhub.display`.
- Android inventory and ADB key material under `data/android-tv/` are persistent runtime state.
- The maintenance container has one deliberately writable persistent ADB-key path: `/managed/classroom-hub/data/android-tv/.android`, backed by the named Docker volume `classroom-control-hub-android-adb`.
- Any release path that may change core Compose mounts must force-recreate the maintenance container. The GUI updater must not rely on plain `docker compose up -d`; it force-recreates core services and verifies the ADB key directory is writable before accepting the release.
- A blank Managed Displays page or permanent `Checking ADB…` after deployment may indicate Hub-to-maintenance network/proxy failure rather than lost pairing; inspect persistence before re-pairing.
- Hub and maintenance use host networking; maintenance remains loopback-only at `127.0.0.1:${MAINTENANCE_PORT:-3010}` and token-authenticated. Do not reintroduce `maintenance-agent:3010` service-DNS assumptions.
- Persistent ADB is opt-in and for trusted management networks only. The tested Onn preserves pairing trust but disables Wireless Debugging during reboot; the agent restores it and the managed endpoint returns on fixed port `5555`.
- Reboot is asynchronous. Temporary ADB loss is expected; UI uses bounded `Recovering…` state rather than immediate permanent failure.
- ADB may return before Android allows foreground kiosk launch; agent can transition through `Starting…` before `Running`.
- Hub recovery should verify/accelerate agent launch as soon as ADB reconnects instead of waiting for the normal background policy interval.
- Remote-shell compound scripts must be correctly quoted for Android `/system/bin/sh`; never pass an unquoted pipeline/conditional as a fragmented `sh -c` sequence.
- Android deep sleep is not the default scheduled power method on the validated Onn because it can remove the ADB/network management path. Keep kiosk/content scheduling, HDMI-CEC panel power, and advanced Android sleep separate.
- Managed Minimal Mode is reversible: audit first, disable only audited third-party user-0 apps, preserve `org.classroomhub.display` and Android/Google TV core services, and provide Restore Apps.

Validated lifecycle: pair/enroll -> configure -> install agent -> persistent ADB bootstrap -> unattended reboot -> Wireless Debugging restored -> fixed `:5555` reconnect -> Hub Online -> agent starts -> assigned `/display/<id>` content returns. HDMI-CEC/physical panel power remains separate follow-up validation.

Canonical references: `docs/ANDROID-TV-DISPLAYS.md`, `docs/PERSISTENT-ANDROID-ADB.md`, `docs/MANAGED-ANDROID-MINIMAL-MODE.md`, `docs/ANDROID-TV-SUPPORT-MATRIX.md`, `docs/MANAGED-DISPLAYS-RECOVERY.md`, `docs/ai/ANDROID-TV-CONTEXT.md`, `wiki/Android-TV-Displays.md`, `wiki/Managed-Displays-Recovery.md`.

## Production configuration

The public repository intentionally uses generic configuration. Production endpoints, credentials, room names, calendar values, stream URLs, device IPs, and school-specific mappings must remain local.

The standard production checkout is `/opt/classroom-hub`. Older documentation or code referring to `/opt/classroom-control-hub` is migration-era configuration unless a deployment explicitly chose it.

School/classroom identity, integration settings and update policy are database-backed. Integration passwords, private keys, and tokens belong in the encrypted secret store and must never be returned by browser APIs. Environment variables remain bootstrap/migration fallbacks and host/container boundary configuration.

Browser displays use enabled stable display IDs without credentials by default. This URL-only behavior is an intentional trusted-classroom-network contract and must not silently become mandatory enrollment during security work. Administrators may opt into individually enrolled, revocable credentials after enrolling every enabled display. Enrollment links are one-use and expiring; raw codes and credentials must never be persisted or returned by administrative read APIs. Protected assets remain signed in either mode.

## Git and release workflow

`main` is the source branch used by production. Normal supported update flow:

```bash
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

For development rebuilds after host state is established:

```bash
docker compose build --no-cache
docker compose up -d --remove-orphans
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

The web-managed updater uses GitHub releases and a native systemd job. It must verify backend, maintenance, Host Agent, database/scheduler health, ADB key-storage writability, and version convergence after recreation, and restore the prior source/data state on failure. It force-recreates both core services so new Compose mounts and hardening changes cannot be skipped by an old container. TLS/Caddy is not currently a release-health dependency.

## Documentation map

- `README.md` — public project overview
- `INSTALL.md` — installation/migration quick guide
- `GITHUB-MIGRATION.md` — Git-based migration and update workflow
- `docs/ARCHITECTURE.md` — architecture
- `docs/CONFIGURATION.md` — configuration
- `docs/CONTROLLER.md` — controller UI
- `docs/DATABASE.md` — persistence/database
- `docs/DEPLOYMENT.md` — deployment and rollback
- `docs/DEVELOPMENT.md` — development
- `docs/HOST-AGENT.md` — host agent
- `docs/OPERATIONS.md` — operations
- `docs/TROUBLESHOOTING.md` — troubleshooting
- `docs/ANDROID-TV-DISPLAYS.md` — Android/Google TV management
- `docs/PERSISTENT-ANDROID-ADB.md` — persistent wireless ADB recovery
- `docs/MANAGED-DISPLAYS-RECOVERY.md` — ADB storage/recreation recovery contract
- `docs/MANAGED-ANDROID-MINIMAL-MODE.md` — reversible managed-display cleanup
- `docs/ANDROID-TV-SUPPORT-MATRIX.md` — validated hardware/firmware matrix
- `wiki/` — Git-tracked mirror of GitHub Wiki pages

Update documentation in the same change whenever behavior or operational procedures change.

## Automation execution contract (alpha.72)

- Automation persistence is SQLite-authoritative even though compatibility helpers still use JSON-like file keys. Stale `data/automations.json` files are not authoritative when `LEGACY_JSON_MIRROR=false`.
- `Test Now` is an execution test, not a calendar eligibility test. It may use a linked class as a synthetic manual context when that class is not scheduled on the current day. The real scheduler continues to enforce school-cycle/date eligibility.
- Class-default display targets are a display-domain policy. They apply to primary display actions, display actions embedded in lighting/TV-led automations, and timer overlays. They never become lighting targets.
- Timer overlay failures and action failures must be returned and persisted with actionable details rather than only the generic `Completed with action errors` status.
- Alternating automations use the authoritative school-cycle anchor from the configured schedule profile; the controller must not depend on an editor-only anchor field.

### Maintenance mutation boundary

Authenticated maintenance mutations share an appliance-wide limit of 30 requests per 60 seconds, enforced after token authentication and before both legacy and extension-wrapped routes. Excess writes return HTTP 429 with a Retry-After header; GET/HEAD/OPTIONS polling and health checks do not consume this budget. Forwarding headers cannot create new budgets. The counter is in memory and resets on a maintenance process restart.

## Display merge review boundaries (2026-09-09)

PR #27 retains one logical layout owner and adds `public/display/security.mjs` for receiver URL/proxy/identify validation. Never return a rejected raw URL from a catch block. External media is an explicit HTTP(S) signage feature, not permission to load javascript/data/file schemes or to navigate the top-level receiver. Keep external frames isolated, proxy paths same-Hub and identify resources bounded. See `docs/DISPLAY-LAYOUT-CONTRACT.md` for behavior and browser verification. Renderer revision: `single-fit-20260909-4`, released with alpha.72.

## Host installer group prerequisite

Resolve host GID 10001 before backup/data/secret mutation. The group inside the image is not a host group record. Source `deploy/host-group.sh`, reuse an existing GID or create `classroom-hub` only when its name and ID are free, and pass the verified name to install. Fail closed on conflicts/lookup errors; never renumber existing groups, add host users to this secret-readable group, or regenerate keys for this error. Keep `test/installer-host-group.test.js` coverage and `docs/HOST-NETWORKING.md` recovery instructions synchronized.
