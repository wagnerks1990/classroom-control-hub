# Release and Upgrade Process

## Versioning

Classroom Control Hub uses semantic-style prerelease versions during development:

```text
1.0.0-alpha.N
1.0.0-beta.N
1.0.0
```

The `alpha` container channel tracks alpha builds. `latest` remains reserved for stable releases.

## Release checklist

Before publishing a release:

1. Update `VERSION`.
2. Update package and embedded component versions.
3. Search for stale prior version strings.
4. Run Node/Python/controller/Compose validation.
5. Build the main and maintenance Docker images.
6. Verify container startup and `/health`.
7. Verify database compatibility and persistent mounts.
8. Verify Host Agent service/socket and maintenance access.
9. Test display reconnect/version convergence.
10. Test automations and manual Run Now/Test Now.
11. Test class timers and Bison continuation rules.
12. Test Morning Announcements playback, HLS detection, audio controls, priority lock, and release.
13. Verify post-announcement failsafe scheduler resync restores the currently applicable automations.
14. Test Background Music pause/resume/recovery.
15. Verify unrelated integration failures do not contaminate other health indicators.
16. Verify slow optional integration checks do not block the Overview UI.
17. Update `CHANGELOG.md`, relevant `docs/` pages, `AGENTS.md`/`docs/AI-CONTEXT.md` when applicable, and the matching `wiki/` mirror pages.

A release is not complete until backend, controller, display renderer, maintenance agent, and host-agent version surfaces converge.

## Production Git upgrade

The standard production checkout is `/opt/classroom-hub`.

Back up first, then update:

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-before-update-$(date +%Y%m%d-%H%M%S)"
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
sudo docker compose build --no-cache
sudo docker compose up -d
sudo docker compose ps
curl -fsS http://localhost:3000/health
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

## Release acceptance

A release is not considered production-ready merely because the container starts. Validate the classroom behaviors that can disrupt instruction: display state, timers, announcements, audio arbitration, schedules, integration health, Host Agent access, and recovery after reconnects.
