# Release and Upgrade Process

## Versioning

Classroom Control Hub uses semantic-style prerelease versions during development:

```text
1.0.0-alpha.N
1.0.0-beta.N
1.0.0
```

The `alpha` container channel tracks alpha builds. `latest` remains reserved for stable releases.

## Current deployment invariant

The current appliance is intentionally HTTP-only. The release must contain only:

```text
classroom-control-hub
classroom-control-hub-maintenance
classroom-hub-host-agent.service
```

Caddy/TLS is not part of the current Compose stack or release-health gate. HTTPS will be reintroduced later as a separate reviewed feature.

## Release checklist

Before publishing a release:

1. Update `VERSION`.
2. Update package and embedded component versions.
3. Search for stale prior version strings.
4. Run Node/Python/controller/Compose validation.
5. Build the main and maintenance Docker images.
6. Verify direct HTTP startup and `/health` on port 3000.
7. Verify database compatibility and persistent mounts.
8. Verify the shared data root remains `root:10001` with the documented modes.
9. Verify the master encryption key is preserved across upgrades.
10. Verify `MAINTENANCE_TOKEN` is non-empty before container recreation.
11. Verify Host Agent service/socket and maintenance access.
12. Test a cold start where the main application is initially absent; maintenance readiness must not deadlock Compose.
13. Test display reconnect/version convergence.
14. Test automations and manual Run Now/Test Now.
15. Validate all migrated class schedule times and automation actions before declaring readiness.
16. Test class timers and explicit continuation rules.
17. Test Morning Announcements playback, HLS detection, audio controls, priority lock, and release.
18. Verify post-announcement failsafe scheduler resync restores the currently applicable automations.
19. Test Background Music pause/resume/recovery.
20. Verify unrelated integration failures do not contaminate other health indicators.
21. Verify slow optional integration checks do not block the Overview UI.
22. Verify an upgrade from the previous live-test release removes any legacy `classroom-control-hub-tls` orphan.
23. Update `CHANGELOG.md`, relevant `docs/` pages, `AGENTS.md`/`docs/AI-CONTEXT.md` when applicable, and the matching `wiki/` mirror pages.

A release is not complete until backend, controller, display renderer, maintenance agent, and Host Agent version surfaces converge and the backend reports database/scheduler readiness.

## Production Git upgrade

The standard production checkout is `/opt/classroom-hub`.

Back up first, then use the supported installer so host permissions, secrets, and migration cleanup are applied:

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-before-update-$(date +%Y%m%d-%H%M%S)"
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

Development rebuild after a valid installation:

```bash
sudo docker compose build --no-cache
sudo docker compose up -d --remove-orphans
sudo docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

Verify the Host Agent after migrations that touch installation paths or systemd:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

After an upgrade, hard-refresh the controller when frontend assets changed and verify physical display clients converge to the same release version.

## Image tags

Intended GHCR pattern:

```text
ghcr.io/wagnerks1990/classroom-control-hub:alpha
ghcr.io/wagnerks1990/classroom-control-hub:1.0.0-alpha.N
```

The maintenance image uses the corresponding maintenance package/tag.

## Rollback

If the release has no incompatible database migration, restore the previous known-good source/image while preserving persistent runtime state.

If the release changes the database schema, follow release-specific rollback instructions and restore the matching database backup if required.

## Web-managed updates

The Infrastructure & Recovery page can check a configured GitHub repository for approved alpha, beta, or stable semantic-version releases. Draft releases and arbitrary source archives are not eligible. Private-repository read tokens are encrypted in the application database.

The native `classroom-hub-app-update.service` resolves the release tag to a Git commit, repairs the runtime HTTP configuration/filesystem prerequisites, refreshes the Host Agent, rebuilds the Compose services, removes legacy Caddy orphans, and verifies the reported application version across the backend, maintenance service, and Host Agent.

Current update health requirements are:

- backend HTTP `/health` succeeds and reports the expected version;
- database and scheduler readiness pass;
- maintenance is healthy and reports the expected version;
- Host Agent is healthy and reports the expected version;
- no TLS/Caddy dependency is required.

Every update has a pre-update operational backup. Deployment failure automatically restores the prior commit, exact retained container images, and backup. **Revert Last Upgrade** restores that same known-good set after first preserving the current state.

The updater runs from an immutable host-installed copy. It verifies the SHA-256 digest of the pinned revert backup, restores matching data before an older application starts, and resumes a root-journaled request after an unexpected restart.

Do not delete `classroom-control-hub-recovery:*` images while the controller offers **Revert Last Upgrade**. Clear an unneeded stored GitHub credential using the controller action; for this public repository no token is required. Revoke the old credential at GitHub when rotating or responding to exposure.

Container publication is gated directly by the tag workflow's locked installs, dependency audits, regression tests, syntax checks, Compose validation, direct HTTP smoke test, and both image builds. A matching `VERSION` and package version alone are not sufficient.

Automatic updates are off by default and run only during the configured maintenance window. Run `sudo ./install.sh` once when upgrading an older installation to install the native updater service.

## HTTPS reintroduction acceptance

Do not add HTTPS back as a minor Compose tweak. A future HTTPS release must have dedicated acceptance tests for DNS/SNI, certificate trust/distribution, HTTP-to-HTTPS migration, reverse-proxy trust configuration, cold-start ordering, and rollback to the HTTP-only release.

## Release acceptance

A release is not considered production-ready merely because the container starts. Validate the classroom behaviors that can disrupt instruction: display state, timers, announcements, audio arbitration, schedules, integration health, Host Agent access, and recovery after reconnects.
