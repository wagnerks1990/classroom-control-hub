# Music Assistant Sendspin TV Audio

## Current validated architecture

Classroom Control Hub separates Music Assistant control traffic from TV audio transport.

- Music Assistant server/API URL: `http://<music-assistant-host>:8095`
- Authenticated Music Assistant API WebSocket: `ws://<music-assistant-host>:8095/ws`
- Dedicated external Sendspin endpoint: `ws://<music-assistant-host>:8927/sendspin`
- Classroom display browsers connect to the Classroom Hub bridge; the Hub backend relays Sendspin protocol frames to the dedicated Music Assistant endpoint on port 8927.

The long-lived Music Assistant API token is encrypted at rest by Classroom Control Hub and is used only for Music Assistant control/API operations. The dedicated Sendspin endpoint on port 8927 is raw Sendspin transport and does not use the old 8095 web-player authentication preamble.

## Why port 8927

Music Assistant exposes different roles on its ports. Port 8095 is the Music Assistant web/API service and its `/sendspin` route is associated with the built-in web-player path. External Sendspin clients use the dedicated Sendspin server, normally `ws://<host>:8927/sendspin`.

Live testing with Music Assistant 2.9.13 validated the Classroom Hub bridge using the dedicated 8927 endpoint. TV1 (`classroom-hub-tv1`) registered and Background Music played continuously through the Windows 11 kiosk without the previous repeated connection replacement/disconnect loop. An earlier `PlayerUnavailableError` during validation was traced to TV1 having been temporarily disabled in Classroom Hub, not to the 8927 transport.

The validated topology is:

```text
Classroom Control Hub ---- authenticated API/control ----> Music Assistant :8095
        |
        +---- display attachment/configuration ----> TV browser
        |
TV browser ---- Classroom Hub Sendspin bridge ----> Hub backend
                                                     |
                                                     +---- raw Sendspin ----> Music Assistant :8927/sendspin
```

The Hub bridge retains one-time display-ticket gating while keeping the Music Assistant API token out of classroom display browsers.

## HTTP installations

Plain HTTP is supported on trusted classroom LANs. With an HTTP Classroom Hub and Music Assistant deployment:

- Use `http://<host>:8095` as the Music Assistant server/API URL.
- The authenticated control API uses the Music Assistant WebSocket/API service on port 8095.
- The Hub's Sendspin upstream uses `ws://<host>:8927/sendspin`.

Browsers on an insecure HTTP origin may report that Opus is unavailable and fall back to FLAC/PCM. FLAC/PCM fallback is expected and can sound excellent. Browser autoplay/AudioContext policy is a separate browser concern and must not be confused with Sendspin transport availability.

## Configuration contract

The stored `musicassistant.config` object keeps these fields:

- `url`: Music Assistant API base URL, normally port 8095.
- `tvBridgeEnabled`: whether Classroom Hub TV audio integration is enabled.
- `sendspinHost`: hostname/IP the Classroom Hub backend uses for the dedicated Sendspin server.
- `sendspinPort`: dedicated Sendspin port, normally 8927.

The backend constructs the upstream as `ws://<sendspinHost>:<sendspinPort>/sendspin` and transparently relays Sendspin frames. It must not append `/sendspin` to the port-8095 API URL for external Classroom Hub players.

## Diagnostics

Verify Music Assistant is listening on the dedicated endpoint:

```bash
ss -ltnp | grep ':8927'
```

Verify the Classroom Hub container can reach it:

```bash
docker exec classroom-control-hub node -e "
const net=require('net');
const s=net.createConnection({host:'host.docker.internal',port:8927},()=>{console.log('Sendspin reachable');s.end()});
s.on('error',e=>{console.error(e);process.exit(1)});
"
```

A successful player session should show the `classroom-hub-tvN` player registered and remain stable without repeated `Replacing existing connection`, `Connection disconnected`, or `PlayerUnavailableError` messages.

If `PlayerUnavailableError` appears, first confirm that the intended TV is attached/enabled in Classroom Hub before treating it as a transport failure.

## Operational status

As of the live validation on 2026-09-09, the dedicated 8927 bridge is considered the accepted working configuration. Further autoplay, HTTPS, SDK-internal, and reconnect experiments are intentionally deferred unless the stable behavior regresses.
