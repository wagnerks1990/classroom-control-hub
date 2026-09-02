# Development

## Source layout

The intended direct-source layout is:

```text
classroom-control-hub/
├── src/                    # main Node.js backend
├── public/                 # controller, display, setup and supporting web UIs
├── maintenance-agent/      # maintenance service
├── host-agent/             # host-level systemd agent
├── config/                 # public defaults/catalog/schema
├── docs/                   # version-controlled documentation
├── tools/                  # validation/development utilities
├── .github/workflows/      # CI and container publishing
├── Dockerfile
├── docker-compose.yml
└── package.json
```

During the initial public migration, some large sanitized source files may temporarily appear under `source-archive/` until their direct-source versions have been committed. The migration is complete only when required runtime source files exist at their normal paths and CI validates them directly.

## Development rules

### Preserve persistent data

Application changes must not require deleting the runtime database or site configuration as a routine upgrade step. Schema changes should use explicit, reviewable migrations.

### Keep deployment-specific values out of source

Do not hard-code real organization domains, internal addresses, credentials, stream IDs, schedules, device identifiers, or tokens into reusable source.

### Keep manual and automatic behavior consistent

Features with both scheduler and manual controls should share backend state transitions rather than duplicate similar logic in separate paths. Morning Announcements are a key example: manual and automatic starts must enter the same priority state.

### Favor reconciliation over cached assumptions

Long-running integrations can reconnect independently. When practical, scheduler decisions should compare intended state to actual external/device state instead of trusting stale in-memory flags.

## Validation

Before committing a release candidate, run syntax/static checks for all major components.

Typical Node checks:

```bash
node --check src/server.js
node --check src/storage.js
node --check maintenance-agent/server.js
node --check maintenance-agent/storage.js
```

Host agent:

```bash
python3 -m py_compile host-agent/server.py
```

Controller validation:

```bash
node tools/validate-controller.js
```

Compose validation:

```bash
docker compose config
```

Build validation:

```bash
docker compose build --no-cache
```

## Version convergence

Before every release, search the source tree for old version strings. All independently loaded components must agree on the current release version.

A release checklist should verify:

- `VERSION`;
- root `package.json`;
- backend-reported version;
- controller constants/footer;
- display renderer constants;
- maintenance-agent package/server;
- host-agent reported version if present;
- reload/version-mismatch guards.

## Release naming

Use semantic prerelease tags:

```text
v1.0.0-alpha.63
v1.0.0-alpha.64
v1.0.0-beta.1
v1.0.0
```

Container channel policy:

- exact prerelease tag for reproducibility;
- `alpha` for newest alpha;
- `beta` for newest beta when introduced;
- `latest` only for stable releases.

## Git workflow

Recommended workflow once initial migration is complete:

```text
feature/fix branch
      ↓
validation
      ↓
pull request
      ↓
main
      ↓
version tag
      ↓
GitHub Actions
      ↓
GHCR images + release notes
```

For urgent classroom fixes during alpha development, direct commits may be practical, but releases should still be traceable to a commit and tag.

## Testing priorities

High-value regression scenarios include:

- multiple displays connecting/reconnecting simultaneously;
- automation execution at period boundaries;
- active-class selection for multi-class events;
- transition timers;
- valid and invalid Bison continuation chains;
- announcement priority takeover and release;
- automations becoming due while announcements are live;
- Background Music pause/resume and Music Assistant reconnect;
- no-school/remote/delay/half-day calendar behavior;
- version mismatch handling without reload loops;
- persistent database survival across image upgrades.

## Documentation requirement

Behavior-changing pull requests should update the relevant `/docs` page and `CHANGELOG.md`. Configuration additions should also update `.env.example` and/or the site configuration schema when applicable.
