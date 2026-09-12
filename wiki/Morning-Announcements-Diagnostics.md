# Morning Announcements Diagnostics

Morning Announcements is a priority live-stream workflow. A confirmed live transition starts the player once. Periodic successful probes must not clear/restart an already-playing stream. Transient failures are observed and recovered without blanking the TVs; release occurs only after a sustained confirmed-offline window.

## Intended monitoring behavior

```text
OFFLINE -> confirmed LIVE -> START once
PLAYING + successful probe -> no player change
PLAYING + transient failure -> keep playing/recover
PLAYING + sustained confirmed OFFLINE -> RELEASE once
```

The current deployment target is a 15-second probe cadence and six consecutive confirmed-offline results, approximately 90 seconds, before release.

## Receiver diagnostics

On a display receiver:

```js
window.ClassroomStreamDiagnostics()
```

This reports active/session state, latest HLS/media status, recent events, errors, recovery counts, duplicate reassertions suppressed, and duplicate takeover clears suppressed.

Stable console prefixes:

```text
[ClassroomHub MorningStream]
[ClassroomHub AntMedia]
```

The integrated HLS player records manifest/level/fragment progress, stalls, network/media errors, buffer-ahead duration, playback time, media ready/network state, browser online/offline events, and recovery attempts. A bounded snapshot is attached to normal display heartbeat metadata so the controller's existing device/diagnostic APIs can expose it.

## Appliance logs

```bash
cd /opt/classroom-hub
sudo docker compose logs -f classroom-hub \
  | grep -Ei 'Morning Announcements|MorningStream|AntMedia|display\.connected|display\.disconnected|stream|probe'
```

For a failure capture:

```bash
sudo docker compose logs --since=15m classroom-hub > /tmp/classroom-hub-stream.log
```

Record the exact failure time, affected display IDs, whether audio/video/both stopped, duration, receiver diagnostics, Morning Announcements runtime, and whether every TV failed simultaneously.

## HLS recovery

The same-origin Ant Media player runs HLS.js without a blob Web Worker under the current application CSP. Network failures are recovered with HLS reload attempts; media/decode failures use HLS media recovery; playlist variants can fall back between standard and adaptive manifests. A playback-progress watchdog detects prolonged buffering.

## Managed Display Gateway

The gateway solves display routing/DNS reachability but is not the stream-end authority. Temporary gateway/proxy failures should be distinguishable from a confirmed publisher shutdown.

Both gateway variables must reach the `classroom-hub` container. The Compose
deployment passes `DISPLAY_GATEWAY_OVERRIDES` and `DISPLAY_GATEWAY_ALLOWED_HOSTS`
from the protected `.env`; force-recreate the Hub container after changing them.
A value present only on the Docker host does not configure the running Hub.

## Future monitoring

Ant Media API/webhooks or another authoritative publisher signal can replace HLS manifest probing later. The replacement must preserve transition-based start/end behavior, UNKNOWN versus OFFLINE distinction, receiver telemetry, and server lifecycle logging.

Player/receiver telemetry reports only a stream URL's origin and pathname. Query
parameters, fragments, and the receiver's private full-URL comparison key are not
included in heartbeat metadata because stream URLs may carry subscriber
credentials. The manual display controller reads the saved stream URL without
rewriting its configuration and refuses to start when no URL is configured.

See the repository document `docs/MORNING-ANNOUNCEMENTS-DIAGNOSTICS.md` for the full diagnostic and acceptance-test contract.
