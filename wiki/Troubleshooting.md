# Troubleshooting

## Controller does not load

```bash
cd /opt/classroom-hub
docker compose ps
curl -fsS http://localhost:3000/health
docker compose logs --tail=200
```

If local health works, check reverse proxy, TLS, firewall, and WebSocket forwarding.

## Host health unavailable / host-agent socket missing

Expected socket:

```text
/run/classroom-control-hub/host-agent.sock
```

Check:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo journalctl -u classroom-hub-host-agent.service -n 100 --no-pager
sudo test -S /run/classroom-control-hub/host-agent.sock
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

The current standard install path is `/opt/classroom-hub`. Older service units pointing at `/opt/classroom-control-hub` or `/run/classroom-hub/host-agent.sock` are stale migration configuration.

## Displays repeatedly reload or flash

A common cause is version mismatch between the backend and display renderer. Verify every embedded version identifier was updated together. Backend, controller, display, maintenance, and host-agent versions must converge.

## Morning Announcements manual playback works but Live Watch does not

Current Ant Media detection uses HLS as the authoritative signal when the HLS URL can be derived from the player URL:

- 200 + valid `#EXTM3U` playlist = LIVE
- 404 = OFFLINE
- network/timeout/5xx = UNKNOWN/error
- blocked REST diagnostics such as 403 must not override HLS

Two confirmed OFFLINE checks are required before ending an active announcement automatically.

If both HLS candidates time out, verify the gateway variables reached the running
`classroom-hub` container rather than existing only in the host `.env`. After fixing
the protected `.env`, force-recreate the Hub container and run **Check Stream Now** again.

## Morning Announcements end but automation does not return

The current release performs a failsafe scheduler resync. After releasing the announcement priority lock it should re-evaluate the current date/class/time, select the newest currently applicable display automation per target, re-run those winners, and only then reconcile Background Music.

Do not restore stale display snapshots or replay all earlier events blindly.

## Announcements can be overwritten by automation

Manual and automatic announcements must share the same priority state. While active, target displays are protected from conflicting scheduled/manual automations and Background Music remains paused.

## Announcement audio controls do not work

Announcement playback should use the locally controlled HLS/HTML5 media element rather than relying on a cross-origin player iframe. Saved volume/mute state should apply directly to the media element.

## Background Music does not resume

Check the actual Music Assistant player/group state and confirm no priority-audio lock remains active. Background Music should resume only after post-announcement display resync is complete.

## Timer shows 00:00 during manual test

For linked class timers, verify the manual run resolves the currently active selected class occurrence instead of falling back to the first configured class.

## Wrong class continuation is chained

Continuation identity is based on an explicit link to the same underlying base period/class. A short time gap alone is not enough. Adjacent regular classes must not chain.

## MQTT / Govee says OFFLINE but MQTT is connected

Integration health must be independent. A failed Pluto request must not cause MQTT/Govee to be shown as offline. Check MQTT runtime status directly.

## Overview is slow to load

Slow optional hardware probes must not block the initial Overview. The page should render lightweight application/device/schedule state first and load detailed hardware state asynchronously.

## Pluto is not configured after migration

Check the running container:

```bash
sudo docker exec classroom-control-hub printenv PLUTO_URL
curl -s http://localhost:3000/health | jq '.runtime.hardware.pluto'
```

The public repository intentionally leaves site-specific Pluto URL values out of tracked defaults.

## Pluto API returns "Authentication required"

`/api/v1/pluto/status` is itself an authenticated Classroom Control Hub endpoint. An unauthenticated CLI `curl` can be rejected by the Hub before any Pluto hardware request occurs. That response alone does not prove Pluto hardware authentication is required.

## Docker/Git update appears to do nothing

```bash
cd /opt/classroom-hub
git status --short
git log -1 --oneline
cat VERSION
docker compose ps
curl -fsS http://localhost:3000/health
```

Confirm the Git checkout advanced and the containers were rebuilt/recreated.

## Before sharing diagnostics publicly

Redact credentials, tokens, student/user data, private URLs, certificates/private keys, and any diagnostic payload containing secrets. Rotate secrets that were accidentally pasted into a public/shared transcript.
