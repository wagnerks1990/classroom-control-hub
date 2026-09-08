# Development

## Development goals

Classroom Control Hub should remain generic, configurable, container-friendly, AI-readable, and safe to deploy in production classrooms without embedding one site's infrastructure into public source.

## Read first

AI assistants and contributors should read:

1. `AGENTS.md`
2. `VERSION` and `CHANGELOG.md`
3. `docs/AI-CONTEXT.md`
4. the relevant technical documentation
5. implementation source

The direct source tree on `main` is canonical. The temporary `source-archive/` migration representation has been removed.

## Local workflow

```bash
git clone https://github.com/wagnerks1990/classroom-control-hub.git
cd classroom-control-hub
cp .env.example .env
npm install
```

## Source layout

```text
src/                 main backend and storage
public/controller/   operator/controller interfaces
public/display/      display renderer
maintenance-agent/   maintenance service
host-agent/          host-level service and helper scripts
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

Runtime `.env`, databases, data, uploads, backups, keys, credentials, stream endpoints, and site hardware mappings stay outside Git.

## Release discipline

Every release should:

1. update `VERSION`;
2. update package/embedded component versions;
3. keep backend/controller/display/maintenance/host-agent versions converged;
4. search for stale previous version strings;
5. run CI-equivalent validation;
6. build both Docker images;
7. verify persistent-data compatibility;
8. test Host Agent socket access;
9. test critical classroom behavior;
10. update `CHANGELOG.md`, `docs/`, `wiki/`, and AI context when applicable.

## Validation

```bash
node --check src/server.js
node --check src/storage.js
node --check maintenance-agent/server.js
node tools/validate-controller.js
python3 -m py_compile host-agent/server.py
bash -n install.sh
docker compose config
docker build -t classroom-control-hub:test .
docker build -t classroom-control-hub-maintenance:test maintenance-agent
```

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

`1.0.0-alpha.70` is the live-test candidate baseline at the time this page was updated. A newer `VERSION` supersedes the version number but not these invariants unless deliberately changed and documented.

## Testing areas

Regression testing should cover:

- controller load/authentication and Overview responsiveness
- display connect/reconnect and version convergence
- scheduled automation and manual Run Now/Test Now
- class timer resolution, explicit continuation, and transition timers
- no-school/remote/half-day/delay rules
- Morning Announcements HLS detection/playback/audio controls
- announcement priority and post-release failsafe resync
- Background Music pause/resume/recovery
- independent MQTT/Govee/Pluto/Veyon/host-agent health
- Host Agent socket after migration/reinstall
- persistence across container rebuilds

## Pull requests

Keep changes focused and explain schema migrations, new environment variables, new persistent paths, security/privilege changes, and any behavioral invariant that changes. Update the relevant docs in the same change.
