# Development

## Development goals

Classroom Control Hub should remain classroom-focused, configurable, container-friendly, AI-readable, and safe to deploy without embedding one site's infrastructure into public source.

## Read first

AI assistants and contributors should read:

1. `AGENTS.md`
2. `VERSION` and `CHANGELOG.md`
3. `docs/AI-CONTEXT.md`
4. the relevant technical documentation
5. implementation source

The direct source tree on `main` is canonical.

## Local workflow

```bash
git clone https://github.com/wagnerks1990/RoomGoblin.git
cd classroom-control-hub
cp .env.example .env
npm install
```

## Source layout

```text
src/                 main backend, storage, startup recovery
public/controller/   operator/controller interfaces
public/display/      display renderer
maintenance-agent/   maintenance service + extension layer
host-agent/          host-level service and controlled wrapper
config/              generic configuration examples/schema
docs/                canonical technical documentation
wiki/                Git-tracked GitHub Wiki mirror
AGENTS.md             AI/contributor operating contract
.github/              Copilot instructions, CI, image publishing
```

## Standard production conventions

```text
checkout: /opt/classroom-hub
host agent socket: /run/classroom-control-hub/host-agent.sock
```

Runtime `.env`, databases, data, uploads, backups, keys, credentials, stream endpoints, managed integration state, and site hardware mappings stay outside Git.

## Release discipline

Every release should:

1. update `VERSION` and package metadata;
2. keep runtime surfaces converged through release stamping/wrappers;
3. search for stale current-baseline version assumptions;
4. run CI-equivalent validation and regression tests;
5. build both Docker images;
6. verify persistent-data/database compatibility;
7. test Host Agent socket access and maintenance startup ordering;
8. test authentication/capability migration behavior;
9. test setup-wizard device reconciliation;
10. test managed integration adopt/deploy/recreate behavior;
11. test critical classroom behavior;
12. update `CHANGELOG.md`, `docs/`, `wiki/`, and AI context.

## Validation

```bash
node --check src/server.js
node --check src/storage.js
node --check src/startup-recovery.js
node --check maintenance-agent/server.js
node --check maintenance-agent/extensions.js
node tools/validate-controller.js
python3 -m py_compile host-agent/server.py host-agent/start.py
npm test
bash -n install.sh
docker compose config
docker build -t classroom-control-hub:test .
docker build -t classroom-control-hub-maintenance:test maintenance-agent
```

## Alpha.71 deployment/recovery invariants

- `DATABASE_FILE` is authoritative; never silently switch to another existing SQLite file.
- Back up every `data/*.db` through SQLite `.backup` before migration.
- Stop the app before active-database canonicalization and validate the destination with `PRAGMA quick_check`.
- Built-in profiles with missing/empty capabilities are repaired; valid custom capability lists are not overwritten.
- Administrator resolves to `capabilities:["*"]`.
- Password punctuation including `!` and `#` survives setup/login/scrypt paths.
- Maintenance Compose health checks the Host Agent directly instead of waiting on the main application.
- Receiver IDs are editable and unique; display groups are pruned when receivers are removed.
- Existing Docker containers may be discovered/adopted for safe lifecycle operations.
- New container creation remains restricted to supported integration templates.
- Supported optional add-ons are Mosquitto, Govee2MQTT, Music Assistant, and Veyon WebAPI.
- Integration persistent data survives container recreation/removal.
- HTTP remains restricted to a trusted LAN until TLS is deliberately reintroduced.

## Priority and scheduling invariants

- Morning Announcements are highest priority.
- Manual and automatic announcement starts use the same priority state.
- Ant Media detection uses HLS as the primary signal when available.
- When announcements end, the scheduler re-evaluates current date/class/time and re-runs the winning current display automations before Background Music resumes.
- Do not restore stale pre-announcement snapshots.
- Timer continuation is only for an explicitly linked continuation of the same base class or period.
- Integration health is independent.
- Slow optional integration probes must not block initial Overview rendering.

## Current known-good baseline

`1.0.0-alpha.74` is the display-access and clean-worktree installer baseline at the time this page was updated. A newer `VERSION` supersedes the version number but not these invariants unless deliberately changed and documented.

Installers copy executable host runners into `/usr/local/libexec` and must not change tracked source modes in `/opt/classroom-hub`. A supported update that starts from a clean checkout must leave `git status --short` empty.

## Testing areas

Regression testing should cover:

- active DB selection with historical alternate database files present;
- administrator/profile recovery and punctuation-heavy passwords;
- controller load/authentication and Overview responsiveness;
- setup receiver edits and shrinking display lists with custom groups;
- Docker discovery/adoption and supported add-on lifecycle;
- display connect/reconnect and version convergence;
- scheduled automation and manual Run Now/Test Now;
- class timer resolution, explicit continuation, and transition timers;
- no-school/remote/half-day/delay rules;
- Morning Announcements HLS detection/playback/audio controls;
- announcement priority and post-release failsafe resync;
- Background Music pause/resume/recovery;
- independent MQTT/Govee/Pluto/Veyon/host-agent health;
- Host Agent socket after migration/reinstall;
- persistence across container rebuilds.

## Pull requests

Keep changes focused and explain schema migrations, environment variables, persistent paths, security/privilege changes, add-on templates, and behavioral invariants. Update the relevant docs in the same change.
