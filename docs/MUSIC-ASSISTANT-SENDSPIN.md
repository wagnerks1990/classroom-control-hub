# Music Assistant Sendspin TV Audio

## Architecture

Classroom Control Hub separates Music Assistant control traffic from TV audio transport.

- Music Assistant server/API URL: `http://<music-assistant-host>:8095`
- Authenticated Music Assistant API WebSocket: `ws://<music-assistant-host>:8095/ws`
- TV Sendspin audio transport: `ws://<music-assistant-host>:8927/sendspin`

The long-lived Music Assistant API token is encrypted at rest by Classroom Control Hub and is used only by the Hub backend for Music Assistant control/API operations. The token is never sent to classroom display browsers.

TV browsers connect directly to Music Assistant's dedicated Sendspin server on port 8927. Classroom Control Hub remains responsible for deciding which displays are attached, issuing player configuration, restoring desired volume/mute state, monitoring player status, and controlling playback through the authenticated API.

## Why direct Sendspin

Live testing against Music Assistant 2.9.13 showed that the previous Hub WebSocket relay could successfully negotiate Sendspin and begin a FLAC stream but Music Assistant then closed the relayed upstream connection with WebSocket code 1000. A direct browser test to `ws://<host>:8927/sendspin` remained open, isolating the failure to the unnecessary relay layer.

The direct topology removes the Hub from the synchronized audio data path:

```text
Classroom Control Hub ---- authenticated API/control ----> Music Assistant :8095
        |
        +---- display attachment/configuration ----> TV browser
                                                   |
TV browser ---------------- direct Sendspin ------> Music Assistant :8927
```

The old `/music-assistant/sendspin-proxy` implementation remains only as a compatibility fallback while migration is tested. It is not the preferred transport.

## HTTP installations

Plain HTTP is supported on trusted classroom LANs. With an HTTP Classroom Hub and Music Assistant deployment:

- Use `http://<host>:8095` in Music Assistant settings.
- The API WebSocket uses `ws://`.
- Sendspin uses `ws://<host>:8927/sendspin`.

Browsers may report that Opus is unavailable in an insecure context and fall back to FLAC/PCM. That fallback is expected. Browser autoplay policy may also require an initial user gesture before an AudioContext can start; this is separate from Sendspin connectivity.

## Diagnostics

From the Classroom Hub host/container, verify port 8927 is reachable:

```bash
docker exec classroom-control-hub node -e "
const net=require('net');
const s=net.createConnection({host:'host.docker.internal',port:8927},()=>{console.log('Sendspin reachable');s.end()});
s.on('error',e=>{console.error(e);process.exit(1)});
"
```

From a display browser console, a raw transport check is:

```js
const s = new WebSocket('ws://<music-assistant-host>:8927/sendspin');
s.onopen = () => console.log('DIRECT MA SENDSPIN OPEN');
s.onclose = e => console.log('DIRECT MA SENDSPIN CLOSE', e.code, e.reason);
s.onerror = e => console.log('DIRECT MA SENDSPIN ERROR', e);
```

A successful Sendspin player session should proceed through connection, player registration, and stream start without repeated reconnects. Music Assistant logs should show the `classroom-hub-tvN` player registered and the Native output protocol selected.

## Configuration contract

The stored `musicassistant.config` object keeps these fields:

- `url`: Music Assistant API base URL, normally port 8095.
- `tvBridgeEnabled`: whether Classroom Hub TV audio integration is enabled.
- `sendspinHost`: hostname/IP reachable directly by the TV browsers.
- `sendspinPort`: dedicated Sendspin port, normally 8927.

`sendspinHost` must be a LAN-reachable address for the displays. `host.docker.internal` is suitable for the Hub container but is generally not suitable as the direct TV endpoint.
