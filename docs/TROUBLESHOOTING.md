# Troubleshooting

## First-response checklist

Before changing code or configuration, capture the current state:

```bash
cd /opt/classroom-control-hub
docker compose ps
curl -fsS http://localhost:3000/health
docker compose logs --tail=200
```

Also record:

- application version;
- browser/controller version shown in the UI;
- affected display IDs;
- whether the issue occurs automatically, manually, or both;
- exact time of the failure;
- current class/calendar state;
- relevant integration/player status.

## Version mismatch / display reload loop

Symptoms:

- displays repeatedly flash or reload;
- a display connects and immediately disconnects;
- behavior begins immediately after an update without any automation being run.

Check that every embedded version string was updated together:

- root `VERSION`;
- root `package.json`;
- backend version;
- controller version/footer constants;
- display renderer version;
- maintenance-agent version;
- host-agent version if it reports one.

Search the source tree for previous release identifiers before publishing.

## Timer shows 00:00

Possible causes:

- manual execution selected the first configured class instead of the currently active class;
- event occurrence context did not include the actual class end timestamp;
- a transition pseudo-class was treated as a normal chain member;
- an unrelated adjacent class was incorrectly chained;
- Test Now was run outside the period being tested.

Validate active-class resolution first. For class-linked events, the runtime should use the currently active selected occurrence when one exists.

## Incorrect Bison/continuation chaining

A short time gap is not enough to establish continuation identity.

The next occurrence must be explicitly recognized as a continuation/Bison block and map to the same underlying period/class. Different regular periods must remain separate even when only a few minutes apart.

## Background Music does not resume

Check:

1. Is a priority-audio lock still active?
2. Does the scheduler believe Background Music should currently be active?
3. What is the actual Music Assistant player/group state?
4. Is manual stop intentionally suppressing restart?
5. Is the date a remote/no-school day that suppresses scheduled music?

The scheduler should reconcile against actual player state rather than trust only a cached `playing` flag.

## Morning Announcements manual playback works but Live Watch says OFFLINE

This means playback and live detection need to be debugged separately.

Inspect Live Watch diagnostics for each probe type. Depending on Ant Media/reverse-proxy configuration, REST and HLS probes may fail even while WebRTC playback works. WebRTC signaling detection should therefore be available as a fallback.

Validate the application ID and stream ID, reverse-proxy WebSocket support, TLS certificate validity, and whether the signaling endpoint is reachable from the Classroom Control Hub server.

## Morning Announcements are overwritten

Confirm the shared announcement priority state is active for both manual and automatic playback. While active, conflicting scheduled automations must be deferred and manual automation runs must not replace the announcement on locked targets.

If manual playback does not set the same priority state as automatic Live Watch, the two execution paths have diverged and should be unified.

## Announcements play but wrong volume is used

The saved announcement volume must be sent when playback starts and reapplied after player reload/unmute retries. Embedded players can recreate their media element during recovery.

Background Music volume and announcement volume are intentionally independent.

## Container starts but controller is unavailable

Check:

```bash
docker compose ps
docker compose logs classroom-control-hub --tail=200
ss -lntp | grep 3000
curl -v http://127.0.0.1:3000/health
```

If local health works but the external URL does not, investigate reverse proxy, DNS, TLS, firewall, and WebSocket forwarding rather than application scheduling logic.

## Database problems

Do not delete the production database as a first troubleshooting step.

Check filesystem permissions, free disk space, SQLite/WAL files, container volume mappings, and migration logs. Make a backup before attempting repair or rollback.

## Update appears to have no effect

Common causes:

- archive extracted into an unintended nested directory;
- Docker image was not rebuilt/pulled;
- old container was not recreated;
- browser cached frontend assets;
- version strings were not converged.

Confirm both source and running versions explicitly.

## Public issue reports

Before posting logs, screenshots, database excerpts, or configuration to a public GitHub issue, redact:

- credentials/tokens;
- internal infrastructure details not intended for publication;
- student or user information;
- private URLs;
- certificates/private keys;
- diagnostic payloads containing secrets.
