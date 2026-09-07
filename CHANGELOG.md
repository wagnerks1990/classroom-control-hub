# Changelog

## Unreleased

### One-command appliance deployment
- Added a clean-machine Ubuntu Server 24.04 bootstrap for `amd64` and `arm64` that installs Docker Engine and Compose from Docker's signed apt repository.
- Added safe temporary source staging, existing-installation refusal, and explicit repository/ref/target overrides.
- Made fresh and in-place installation idempotent, generated distinct setup/control/display/lab/maintenance secrets, and printed the token-bearing first-time setup URL after health and version convergence.
- Added the lab-agent credential to the Compose application environment and CI shell validation for the bootstrap.

### School and classroom identity and theming
- Added a public, secret-free branding contract backed by the SQLite site profile so login, setup, controller, embedded tools, and renderer surfaces share one identity.
- Added GUI settings for school/district name, classroom name, product name, logo, favicon, and theme mode/colors.
- Kept the product focused strictly on classroom and education workflows; removed the experimental organization/site/space and neutral-terminology model.
- Added revision metadata and validation for theme colors and brand asset URLs.

### Verified web updates and rollback
- Replaced the controller's arbitrary source-ZIP update workflow with GitHub release checks using configurable alpha, beta, or stable channels.
- Added database-backed automatic-update policy, maintenance windows, encrypted private-repository token storage, and update history.
- Added a native host application-update job that accepts semantic-version tags, preserves runtime state, rebuilds the Compose services, verifies application/version health, and automatically rolls back failures.
- Added a one-click controller action to restore the prior source commit and its matching pre-upgrade database/configuration backup.

### Documentation / migration hygiene
- Standardized the documented/default production checkout on `/opt/classroom-hub`.
- Corrected Host Agent service/install defaults to use `/opt/classroom-hub` and `/run/classroom-control-hub/host-agent.sock`.
- Added `AGENTS.md`, `docs/AI-CONTEXT.md`, and GitHub Copilot instructions so AI-assisted changes use the current architecture, production layout, release rules, and behavioral invariants.
- Updated the Git-tracked Wiki mirror and documentation indexes.
- Removed the completed `source-archive` migration payload and one-off alpha.65/alpha.66 materialization/release scaffolding now that direct source files are canonical.

## 1.0.0-alpha.66 - 2026-09-03

### Fixed
- Morning Announcements now perform a failsafe scheduler resync when the stream ends instead of restoring a snapshot or guessing one historical event.
- The newest currently applicable display automation is selected independently per display target.
- Class-linked automations are only eligible while their linked class occurrence is currently active.
- Deferred automations are consumed by the resync so they cannot double-fire after release.
- Winning automations are re-run oldest-to-newest so newer overlapping automation remains authoritative.
- Background Music resumes only after display automation reconciliation completes.

## 1.0.0-alpha.65

- Make Ant Media HLS the authoritative Morning Announcements live/offline probe.
- Treat primary HLS HTTP 200 plus a valid playlist as LIVE and HTTP 404 as OFFLINE.
- Stop treating blocked REST/WebRTC probes as stream-state evidence.
- Treat network/proxy failures as UNKNOWN so transient failures do not consume offline confirmations.
- Preserve two confirmed OFFLINE checks before automatic release.
- Report HLS media sequence when available for diagnostics.

## 1.0.0-alpha.64

- Morning Announcements now use a same-origin integrated Ant Media/HLS player on classroom displays.
- Announcement Mute, 50%, 75%, 100%, slider, Retry/Unmute, and Reload/Unmute controls now act on the real HTML5 media element instead of a cross-origin iframe.
- Added HLS.js for Chromium-compatible HLS playback while retaining the configured Ant Media `play.html` URL as the source-of-truth.
- Preserved announcement priority takeover, Background Music pause/resume, and deferred automation behavior.

## 1.0.0-alpha.63

Initial public GitHub/Docker migration of Classroom Control Hub.

- Renamed the project for general classroom/lab use.
- Removed production site-specific hardware mappings and defaults from the public source tree.
- Moved announcement stream configuration to environment/runtime configuration.
- Added public `.gitignore`, `.dockerignore`, and `.env.example` files.
- Added GitHub Actions workflows for validation and GHCR container publishing.
- Preserved the existing modular display, automation, announcement-priority, background-music, AV, lighting, lab, maintenance, and host-agent architecture.
