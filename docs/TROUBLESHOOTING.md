# Troubleshooting

## First-response checklist

Before changing code or configuration, capture the current state:

```bash
cd /opt/classroom-hub
docker compose ps
curl -fsS http://localhost:3000/health
docker compose logs --tail=200
```

Also record:

- application version;
- browser/controller/display build version;
- affected display IDs;
- whether the issue occurs automatically, manually, or both;
- exact time of the failure;
- current class/calendar state;
- relevant integration/player status.

## Host health unavailable / ENOENT host-agent socket

Symptom:

```text
Host agent unavailable: connect ENOENT /run/classroom-control-hub/host-agent.sock
```

Verify the native service and socket:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo journalctl -u classroom-hub-host-agent.service -n 100 --no-pager
sudo ls -la /run/classroom-control-hub/
sudo test -S /run/classroom-control-hub/host-agent.sock
```

The current standard service must run from `/opt/classroom-hub` and create `/run/classroom-control-hub/host-agent.sock`.

Then verify the maintenance container sees the same socket:

```bash
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

If an older unit points at `/opt/classroom-control-hub` or `/run/classroom-hub/host-agent.sock`, reinstall/correct the unit, run `systemctl daemon-reload`, restart the Host Agent, then recreate/restart the maintenance container.

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
- host-agent version.

Search the source tree for previous release identifiers before publishing.

## Timer shows 00:00

Possible causes:

- manual execution selected the first configured class instead of the currently active class;
- event occurrence context did not include the actual class end timestamp;
- a transition pseudo-class was treated as a normal chain member;
- an unrelated adjacent class was incorrectly chained;
- Test Now was run outside the period being tested.

Validate active-class resolution first. For class-linked events, the runtime should use the currently active selected occurrence when one exists.

## Incorrect class-continuation chaining

A short time gap is not enough to establish continuation identity.

The next occurrence must use “Continuation Of” and map to the same underlying base period/class. Imported legacy schedules may use the compatibility switch. Different regular periods must remain separate even when only a few minutes apart.

## Background Music does not resume

Check:

1. Is a priority-audio lock still active?
2. Does the scheduler believe Background Music should currently be active?
3. What is the actual Music Assistant player/group state?
4. Is manual stop intentionally suppressing restart?
5. Is the date a remote/no-school day that suppresses scheduled music?
6. Did post-announcement display resync finish before Background Music reconciliation ran?

The scheduler should reconcile against actual player state rather than trust only a cached `playing` flag.

## Morning Announcements manual playback works but Live Watch says OFFLINE

Playback and live detection should be debugged separately, but the current Ant Media model uses HLS as the authoritative live-state signal when the HLS URL can be derived from the configured player URL.

Expected interpretation:

- HTTP 200 plus a valid `#EXTM3U` playlist = LIVE;
- HTTP 404 = OFFLINE;
- network/timeout/5xx failure = UNKNOWN/error, not definitive OFFLINE;
- blocked REST diagnostics such as HTTP 403 must not override valid HLS state.

Two confirmed OFFLINE checks are required before automatically ending an active Morning Announcements session.

If both HLS candidates time out, verify the running container received the gateway
configuration, not merely that the host `.env` contains it:

```bash
docker compose exec -T classroom-hub sh -lc \\
  'test -n "$DISPLAY_GATEWAY_OVERRIDES" && test -n "$DISPLAY_GATEWAY_ALLOWED_HOSTS"'
```

After correcting the protected `.env`, recreate the Hub with
`docker compose up -d --force-recreate classroom-hub` and run **Check Stream Now** again.

## Morning Announcements end but classroom automation does not return

Current behavior should perform a failsafe scheduler resync after the announcement lock is released. It should:

1. clear Morning Announcements;
2. release the priority lock;
3. re-evaluate the current date/class/time;
4. choose the newest currently applicable display automation for each target;
5. re-run those winners;
6. reconcile/resume Background Music afterward.

Do not restore a stale display snapshot or blindly replay every earlier event.

## Morning Announcements are overwritten

Confirm the shared announcement priority state is active for both manual and automatic playback. While active, conflicting scheduled automations must be deferred and manual automation runs must not replace the announcement on locked targets.

## Announcements play but wrong volume is used

Announcement playback should use the locally controlled HTML5 media element/HLS player. Saved announcement volume must be applied to that media element and reapplied after reload/unmute recovery.

Background Music volume and announcement volume are intentionally independent.

## MQTT / Govee shows OFFLINE while MQTT is connected

Integration health must be evaluated independently. Check backend runtime/diagnostic MQTT state rather than relying on a combined endpoint whose HTTP status may be affected by another integration.

A Pluto failure must not cause MQTT/Govee to be displayed as OFFLINE.

## Overview takes many seconds to load

Look for slow optional hardware probes in diagnostics/audit timing. The initial Overview should render from lightweight application, device, and schedule state and refresh slow hardware status asynchronously.

If Pluto is unconfigured, the application should not repeatedly probe an empty URL. If configured but slow/unreachable, detailed Pluto status still must not block the rest of the Overview.

## Pluto reports not configured

Check the running container environment:

```bash
sudo docker exec classroom-control-hub printenv PLUTO_URL
curl -s http://localhost:3000/health | jq '.runtime.hardware.pluto'
```

The public repository leaves `PLUTO_URL` generic/empty. Production must restore the local endpoint through `.env`.

## `/api/v1/pluto/status` says Authentication required

The RoomGoblin API endpoint itself requires an authenticated controller session. An unauthenticated command-line `curl` can therefore return:

```json
{"ok":false,"error":"Authentication required","authRequired":true}
```

That response does **not** prove that the Pluto hardware requires credentials. Test hardware reachability through an authenticated Hub request or direct local hardware request appropriate to the device protocol.

## Container starts but controller is unavailable

Check:

```bash
docker compose ps
docker compose logs classroom-hub --tail=200
ss -lntp | grep 3000
curl -v http://127.0.0.1:3000/health
```

If local health works but the external URL does not, investigate reverse proxy, DNS, TLS, firewall, and WebSocket forwarding rather than application scheduling logic.

## Database problems

Do not delete the production database as a first troubleshooting step.

Check filesystem permissions, free disk space, SQLite/WAL files, container volume mappings, and migration logs. Make a backup before attempting repair or rollback.

## Update appears to have no effect

For current Git-based production installs, check:

```bash
cd /opt/classroom-hub
git status --short
git log -1 --oneline
cat VERSION
docker compose ps
curl -fsS http://localhost:3000/health
```

Common causes:

- `git pull` was not run or could not fast-forward;
- local tracked changes blocked the pull;
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

If a secret was pasted into a public or shared troubleshooting transcript, rotate it.
