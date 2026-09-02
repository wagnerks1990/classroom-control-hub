# Development

## Development goals

Classroom Control Hub should remain generic, configurable, container-friendly, and safe to deploy in production classrooms without embedding one site's infrastructure into public source.

## Local workflow

```bash
git clone https://github.com/wagnerks1990/classroom-control-hub.git
cd classroom-control-hub
cp .env.example .env
npm install
```

Use the provided validation tooling before commits. Docker should be used to validate the production runtime path.

## Source layout

```text
src/                 main backend and storage
public/controller/   operator/controller interfaces
public/display/      display renderer
maintenance-agent/   maintenance service
host-agent/          host-level service and helper scripts
config/              generic configuration examples/schema
docs/                canonical project documentation
wiki/                wiki-ready documentation source
.github/workflows/   CI and image publishing
```

## Release discipline

Every release should:

1. update the root `VERSION`;
2. update package versions where applicable;
3. update embedded backend/controller/display/agent versions;
4. search the tree for stale previous version strings;
5. run syntax and validation checks;
6. build Docker images;
7. verify persistent-data compatibility;
8. document behavioral changes in `CHANGELOG.md`.

Version convergence is especially important for the display renderer because backend/client mismatch can cause reload loops.

## Configuration policy

Do not hard-code a production organization, domain, private IP, room schedule, stream URL, device credential, or API token into source code. New site-specific behavior should be expressed through runtime configuration or documented integration adapters.

## Persistence policy

Treat containers as replaceable. Any state that must survive upgrades belongs in a mounted persistent path or external service.

## Priority and scheduling changes

Changes to automation execution must preserve the priority model:

```text
Priority announcement > priority A/V automation > normal visual automation > background music
```

Manual and automatic invocation paths for the same feature should use the same backend state machine whenever possible. Duplicate execution paths are a frequent source of behavioral drift.

## Testing areas

At minimum, regression testing should cover:

- controller load and authentication
- display connect/reconnect
- display version convergence
- scheduled automation execution
- manual Run Now/Test Now
- class timer resolution
- Bison continuation rules
- transition timers
- no-school/remote/half-day/delay rules
- Morning Announcements manual playback
- Morning Announcements live detection
- priority lock/release behavior
- Background Music pause/resume/recovery
- persistence across container rebuilds

## Pull requests

Keep changes focused and explain any schema migration, new environment variable, new persistent path, or security/privilege requirement in the PR description and documentation.
