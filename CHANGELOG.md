# Changelog

## Unreleased - Host-network migration

- Rate-limit authenticated maintenance mutations across legacy and wrapped add-on routes, preserving health polling and returning HTTP 429 with Retry-After under write floods.

- Use host networking for both core containers and all reviewed managed add-on deployment templates; remove bridge DNS, host-gateway and port-publishing dependencies.
- Keep maintenance bound to loopback with a configurable port; preserve Hub bind/port settings and verify effective listeners during installation and updates.
- Resolve exact legacy local integration aliases without rewriting remote endpoints or secrets; fix browser links and display network modes/migration warnings in the controller.
- Map custom Mosquitto/Node-RED ports to actual service listeners. Require host mode in Host Agent container creation policy and preserve non-destructive adoption.
- Add regression tests, host-network preflight, real-container networking smoke tests with a fake native-agent fixture, and synchronized operational/wiki/AI documentation.
## Unreleased — PR #27 display correction

- Replace competing inline/observer fitters with one resolution-independent layout engine for title, subtitle, body and timer; grow short content, contain long content and preserve layout across timer ticks/reloads.
- Package same-origin fonts and add Chromium/Firefox geometry, reload, overflow and timer tests.
- Validate receiver media schemes/credentials and nested viewers; isolate external signage frames; restrict Music Assistant sockets to the ticketed same-Hub proxy.
- Bound and replace identification timers, including cancellation on display clear. Add unit and browser security/lifecycle coverage.
- Update display documentation, AI guardrails and the wiki mirror. Renderer revision `single-fit-20260909-2`; application version remains alpha.71 pending a separately tagged release.

## 1.0.0-alpha.71 - 2026-09-08

### Added

- Appliance-wide Docker discovery/lifecycle control for containers already present on the host while keeping new `docker run` operations restricted to reviewed integration images.
- First-class optional managed add-ons for Mosquitto (`eclipse-mosquitto:latest`), Govee2MQTT (`ghcr.io/wez/govee2mqtt:latest`), Music Assistant (`ghcr.io/music-assistant/server:latest`), and Veyon WebAPI (`veyon/webapi-proxy:latest`).
- Adopt-without-recreate, explicit deploy/recreate, and managed removal paths that preserve supported integration data outside container writable layers.
- Startup recovery for built-in access profiles whose capability arrays were lost during migration; Administrator is restored to `capabilities:["*"]` without overwriting valid non-empty custom capability lists.
- Regression coverage for punctuation-heavy passwords, active-database recovery, managed add-on contracts, setup receiver reconciliation, and maintenance startup ordering.
- Build-time release stamping for large controller/display/Windows-agent runtime surfaces and maintenance runtime diagnostics.

### Changed

- Removed the Caddy/TLS gateway from the active appliance architecture and standardized the current live-test deployment on direct HTTP port 3000 for trusted classroom/admin networks.
- Maintenance Compose health now validates the native Host Agent directly instead of calling a readiness path that could wait on the main application and deadlock startup.
- Host Agent startup now extends safe lifecycle/log/inspect control to Docker containers that already exist on the appliance while preserving an allowlist for new integration images.
- Music Assistant is no longer treated as permanently external-only: an existing container can be adopted in place or deliberately promoted to a Hub-managed deployment.
- Setup Wizard receiver IDs are editable, unique, and authoritative instead of being a disabled `tv1..tvN` preview.
- Production installation/update documentation now directs established appliances through `install.sh` so secrets, permissions, Host Agent code, database identity, and migration state are reconciled before container recreation.

### Fixed

- Prevented alpha.70 container recreation from silently switching between `classroom-hub.db` and `classroom-control-hub.db`; installer migration now snapshots every `data/*.db`, preserves the configured active database, validates migrated copies with `PRAGMA quick_check`, and retains old files for rollback.
- Repaired the alpha.70 Administrator profile that could exist/enabled with no capabilities and therefore authenticate successfully while receiving no authorization.
- Confirmed and regression-tested passwords containing shell-significant punctuation such as `!` and `#`; application JSON/scrypt handling treats them as opaque password characters while shell troubleshooting uses safe quoting.
- Fixed Setup Wizard display-count reductions leaving stale display-group members such as a group referencing a removed `tv3` receiver.
- Fixed Setup Wizard offering an adoption action for Music Assistant that called a backend path which rejected external-only integrations.
- Preserved the legacy master-key path during migration, generated missing maintenance secrets before recreation, and established shared data-root ownership compatible with both the non-root application and hardened maintenance container.
- Removed the legacy TLS container/orphan during migration and removed TLS/Caddy from update health gates.

## 1.0.0-alpha.70 - 2026-09-08

### Added

- A privacy-first browser-history opt-in, Windows agent capability/event telemetry, GUI removal of stored GitHub tokens, and capability-aware backup restore actions.
- End-to-end live-test quality gates covering release-version convergence, Windows command parity, strict schedule values, authorization boundaries, database readiness, rollback ordering, and bounded release checks.
- A GitHub Actions Compose smoke deployment that builds the appliance, starts the backend and Caddy gateway, and verifies HTTP and HTTPS health.
- Windows lab-agent screenshots, Chrome/Edge/Firefox history reporting, capability advertisement, bounded command execution, active-session lock/logoff handling, protected atomic configuration, and self-update rollback.
- SQLite integrity/readiness checks, WAL-aware size reporting, scheduler validation, and automatic retained-screenshot reconciliation.

### Changed

- Made initial administrator creation transactional, display enrollment URLs canonical, lab-computer removal revoke all agent access, and authenticated appliance maintenance available from the controller by default.
- Made class and automation changes validate and persist atomically, reject duplicate IDs and unsupported secondary actions, and protect referenced classes from deletion.
- Made school timezone and classroom identity database-backed operational settings instead of decorative GUI values.
- Split liveness/readiness behavior and removed classroom topology from the public health response.
- Bound fresh Compose backend access to loopback so Caddy remains the external HTTPS boundary.
- Preserved Caddy's sole executable file capability under the hardened container profile and included the release VERSION in the runtime image.
- Hardened installation targets, migration snapshots, immutable update runners, resumable update requests, backup checksums, pinned rollback points, and release tag/version preflight.
- Reordered first-run setup so the administrator exists before privileged integration discovery.
- Added capability-aware controller navigation and safer rendering of database and integration values.

### Fixed

- Disabled or missing assigned access profiles now fail closed and invalidate affected browser and WebSocket sessions.
- Rollback restores the matching database and data, with correct UID/GID ownership, before the older application starts.
- Active SVG uploads are rejected, CSV formula cells are neutralized, login throttling is bounded, password verification is asynchronous, and GitHub release checks time out.
- Strict clock and calendar validation now rejects impossible values such as `99:99` and invalid dates.
- Presentation and media conversion preserve the last known-good render on failure and use collision-resistant staging names.
- Removed the incomplete, site-specific legacy classroom-session experience and its missing assets; retired endpoints now return `410 Gone`.
- Removed stale classroom-specific announcement wording and obsolete frontend version labels while preserving the Built by Kyle Wagner attribution.

## 1.0.0-alpha.68 - 2026-09-08

### Added

- Database-backed school schedule profiles with configurable cycle days, day groups, anchors, period mappings, exception times, and continuation rules.
- SHA-256 manifests for Windows lab-agent installation and in-place agent updates.
- Unit coverage for generic schedule normalization, exception transforms, and legacy-profile isolation.
- Automatic GitHub Release creation after both tagged container images publish successfully.
- A one-click Caddy HTTPS gateway with an appliance-owned CA; fresh installs bind the backend’s maintenance port to loopback.

### Changed

- Replaced district-specific schedule editor language and presets with school-configurable controls while importing existing installations through a compatibility profile.
- Expanded teacher and technician access profiles and enforced granular capabilities on schedules, automations, media, diagnostics, lab control, integration checks, and controller WebSockets.
- Restricted web upgrades to the trusted upstream repository and made rollback points single-use so repeated reverts cannot pair source with the wrong backup.
- Reduced maintenance-container write access to application data and known integration data directories; the container is now read-only with all Linux capabilities dropped.
- Restricted native service actions/log access to classified units and replaced permissive Docker-run filtering with an explicit option parser.
- Persisted the display asset signing key and applied privacy retention immediately after startup.

### Fixed

- Protected integration status and scene endpoints that previously exposed operational details without authentication.
- Completed fragmented Windows WebSocket message assembly and prevented overlapping receive operations during heartbeat waits.
- Escaped all five HTML-sensitive characters in controller-rendered values.

## 1.0.0-alpha.67 - 2026-09-08

- Locked both Node dependency graphs and upgraded `adm-zip` and `pdfjs-dist` past their high-severity advisories; CI now uses `npm ci`, production audits, immutable action SHAs, and container SBOM/provenance attestations.
- Closed anonymous classroom topology, event, configuration, and media APIs. Enrolled displays receive renewable signed asset access while controller users continue using authenticated sessions.
- Activated database-backed capability profiles and protected browser history, screenshots, framebuffers, and monitoring alerts behind the `lab.sensitive.read` capability.
- Added GUI-managed student-data retention for browser history, screenshots, alerts, and audit records.
- Added one-time Windows lab-agent enrollment, per-computer credential hashing, rotation/revocation, DPAPI-protected local credential storage, installer/uninstaller scripts, and Authenticode publisher enforcement when configured.
- Removed Docker socket access from the maintenance container. Docker operations now cross the local host-agent socket and a pinned container/image/operation allowlist.
- Retired web-based source, `.env`, arbitrary shell, and source-ZIP mutation surfaces. Runtime configuration remains in structured database-backed forms.
- Corrected custom-port update health checks, verified the expected GitHub origin and `origin/main` ancestry, retained automatic database/source rollback, and documented detached-release recovery.
- Hardened containers with health checks, dependency ordering, no-new-privileges, a non-root read-only main application, and graceful SIGTERM/SIGINT shutdown with a SQLite checkpoint.
- Normalized default configuration keys, installation paths, service-root naming, integration versions, and removed the dead Portainer deployment branch.
- Began incremental modularization with dedicated version and security modules and expanded regression coverage for lab enrollment and capability isolation.

## Unreleased

### Licensing
- Made Classroom Control Hub source-available under PolyForm Noncommercial 1.0.0 with copyright held by Kyle Wagner, required attribution, and separate commercial licensing.

### Individually enrolled classroom displays
- Replaced the normal shared display-token workflow with one-time, expiring enrollment links and a unique revocable credential for each display browser.
- Added controller coverage reporting, enrollment-link creation/cancellation, credential rotation/revocation, and a guarded switch for disabling legacy shared-token access.
- Stored only SHA-256 hashes of enrollment codes and display credentials in SQLite; raw credentials are returned once to the enrolling display and never exposed by administration APIs.
- Preserved display credentials across name and configuration changes while revoking them automatically when a display is removed.

### Database-backed classroom integration settings
- Added structured controller settings for MQTT/Govee, Pluto AV matrix, and Veyon classroom-computer connections.
- Stored connection settings in SQLite and MQTT/Veyon credential material in the encrypted secret store without returning secret values to browsers.
- Applied connection changes live, including MQTT reconnection and Veyon connection-pool invalidation, while retaining environment variables as bootstrap/migration fallbacks.
- Added validation for integration URL schemes, embedded credentials, Veyon scan ranges, timeouts, retries, and concurrency limits.

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
