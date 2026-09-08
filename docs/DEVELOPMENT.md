# Development

## Read first

AI assistants and contributors should read `AGENTS.md` and `docs/AI-CONTEXT.md` before changing behavior.

The direct source tree on `main` is canonical. The temporary `source-archive/` migration payload and materialization workflow have been removed.

## Source layout

```text
classroom-control-hub/
├── src/                    # main Node.js backend
├── public/                 # controller, display, setup and supporting web UIs
├── maintenance-agent/      # maintenance service
├── host-agent/             # host-level systemd agent
├── config/                 # public defaults/catalog/schema
├── docs/                   # version-controlled technical documentation
├── wiki/                   # Git-tracked GitHub Wiki mirror
├── tools/                  # validation/development utilities
├── .github/workflows/      # CI and container publishing
├── AGENTS.md               # AI/contributor operating contract
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Development rules

### Preserve persistent data

Application changes must not require deleting the runtime database or site configuration as a routine upgrade step. Schema changes should use explicit, reviewable migrations.

Production runtime `.env`, databases, data, uploads, backups, master keys, private keys, and credentials are not replaceable source files.

### Keep deployment-specific values out of source

Do not hard-code real school/district domains, internal addresses, credentials, stream IDs, schedules, device identifiers, or tokens into reusable public source.

### Keep manual and automatic behavior consistent

Features with both scheduler and manual controls should share backend state transitions rather than duplicate similar logic in separate paths. Morning Announcements are a key example: manual and automatic starts enter the same highest-priority state.

### Favor reconciliation over cached assumptions

Long-running integrations can reconnect independently. When practical, scheduler decisions should compare intended state to actual external/device state instead of trusting stale in-memory flags.

When Morning Announcements end, current display state is recovered by a scheduler resync, not by restoring a stale snapshot.

### Keep integration health independent

A failed integration must not mark unrelated integrations offline. Slow optional hardware probes must not block initial controller Overview rendering.

## Standard production layout

The standard production checkout is `/opt/classroom-hub`. The Host Agent uses `/run/classroom-control-hub/host-agent.sock`.

Do not reintroduce migration-era `/opt/classroom-control-hub` assumptions into default paths unless explicitly supporting a custom deployment path.

## Validation

Before committing a release candidate, run the checks represented by `.github/workflows/validate.yml`.

```bash
node --check src/server.js
node --check src/storage.js
node --check maintenance-agent/server.js
node tools/validate-controller.js
python3 -m py_compile host-agent/server.py
docker compose config
docker build -t classroom-control-hub:test .
docker build -t classroom-control-hub-maintenance:test maintenance-agent
```

For installer changes, also run:

```bash
bash -n install.sh
```

## Version convergence

Before every release, search the source tree for old version strings. All independently loaded components must agree on the current release version.

Verify:

- `VERSION`;
- root `package.json`;
- backend-reported version;
- controller constants/footer;
- display renderer constants;
- maintenance-agent package/server;
- host-agent reported version;
- reload/version-mismatch guards.

## Current known-good baseline

At the time this document was updated, `1.0.0-alpha.70` is the live-test candidate baseline. It includes configurable school scheduling plus the dependency, API privacy, capability, agent-enrollment, updater, recovery, and maintenance-plane hardening described in the changelog.

A newer `VERSION` supersedes the version number, but existing behavioral invariants remain unless deliberately changed and documented.

## Git workflow

Preferred workflow:

```text
feature/fix branch
      ↓
validation
      ↓
pull request
      ↓
main
      ↓
version tag/release
      ↓
GitHub Actions
      ↓
GHCR images + release notes
```

Urgent classroom alpha fixes may be committed directly when necessary, but they must remain traceable, validated, and documented.

## Production update workflow

```bash
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
docker compose build --no-cache
docker compose up -d
docker compose ps
curl -fsS http://localhost:3000/health
```

Always back up production state before upgrades.

## Testing priorities

High-value regression scenarios include:

- multiple displays connecting/reconnecting simultaneously;
- automation execution at period boundaries;
- active-class selection for multi-class events;
- transition timers;
- valid and invalid explicit continuation chains;
- announcement priority takeover and HLS live/offline detection;
- announcement volume/mute controls;
- automations becoming due while announcements are live;
- post-announcement failsafe scheduler resync;
- Background Music pause/resume and Music Assistant reconnect;
- no-school/remote/delay/half-day calendar behavior;
- independent integration health;
- Overview responsiveness when hardware is slow/unconfigured;
- Host Agent socket visibility after install/migration;
- version mismatch handling without reload loops;
- persistent database survival across image upgrades.

## Documentation requirement

Behavior-changing changes should update `CHANGELOG.md`, the relevant `docs/` page, and the matching `wiki/` mirror page. Changes that materially affect future AI/contributor decisions should also update `AGENTS.md` and/or `docs/AI-CONTEXT.md`.
