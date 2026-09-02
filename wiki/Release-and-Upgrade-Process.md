# Release and Upgrade Process

## Versioning

Classroom Control Hub uses semantic-style prerelease tags during development:

```text
v1.0.0-alpha.N
v1.0.0-beta.N
v1.0.0
```

The `alpha` container channel should track current alpha builds. The `latest` tag should be reserved for stable releases.

## Release checklist

Before publishing a release:

1. Update `VERSION`.
2. Update package and embedded component versions.
3. Search for stale prior version strings.
4. Run Node/Python/shell/static validation.
5. Build the main and maintenance Docker images.
6. Verify container startup and `/health`.
7. Verify database compatibility and persistent mounts.
8. Test display reconnect/version convergence.
9. Test automations and manual Run Now/Test Now.
10. Test class timers and continuation rules.
11. Test Morning Announcements playback, detection, priority lock, and release.
12. Test Background Music pause/resume/recovery.
13. Update `CHANGELOG.md` and documentation.

## Image tags

Intended GHCR pattern:

```text
ghcr.io/wagnerks1990/classroom-control-hub:alpha
ghcr.io/wagnerks1990/classroom-control-hub:v1.0.0-alpha.N
```

The maintenance image may use a separate package name/tag when published independently.

## Production upgrade

Back up first, then pull and recreate containers:

```bash
cd /opt/classroom-control-hub
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
docker compose pull
docker compose up -d
curl -s http://localhost:3000/health
```

After an upgrade, hard-refresh the controller when frontend assets changed and verify physical display clients converge to the same release version.

## Rollback

If the release has no incompatible database migration, restore the previous image tag and recreate the containers while leaving persistent data intact.

If the release changes the database schema, follow release-specific rollback instructions and restore the matching database backup if required.

## Release acceptance

A release is not considered production-ready merely because the container starts. Validate the classroom behaviors that can disrupt instruction: display state, timers, announcements, audio arbitration, schedules, and recovery after reconnects.
