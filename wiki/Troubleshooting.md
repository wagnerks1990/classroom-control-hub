# Troubleshooting

## Controller does not load

1. Check `docker compose ps`.
2. Check `curl -s http://localhost:3000/health`.
3. Review `docker compose logs --tail=200`.
4. Verify reverse-proxy host, port, TLS, and WebSocket forwarding.
5. Confirm persistent storage is writable by the container.

## Displays repeatedly reload or flash

A common cause is version mismatch between the backend and display renderer. Verify every embedded version identifier was updated together in the release. A stale renderer can reconnect, be told to reload, reconnect with the same old version, and enter a permanent loop.

## Display is online but does not update

Verify the display ID, selected target, WebSocket connection, current priority lock, and whether the display is rendering a higher-priority announcement.

## Morning Announcements manual playback works but automatic Live Watch does not

Separate playback from detection. If the embedded Ant Media player works but Live Watch reports offline, inspect the live probe diagnostics. Depending on deployment, REST/HLS status endpoints may be unavailable while WebRTC signaling is usable.

Check:

- configured stream/application ID;
- reverse-proxy WebSocket support;
- Ant Media `/websocket` signaling reachability;
- REST/HLS probe status;
- Live Watch time window and school-day rules.

## Announcements can be overwritten by automation

Manual and automatic announcements must share the same announcement priority state. While active, target displays should be locked against conflicting scheduled and manual automations, and Background Music should remain paused.

## Background Music does not resume

Check the actual Music Assistant player/group state. The scheduler should reconcile against the real player state rather than trusting only cached `playing` state. Confirm no announcement or priority audio lock remains active.

## Timer shows 00:00 during manual test

For linked class timers, verify the manual run resolves the currently active selected class occurrence instead of falling back to the first configured class. Testing a transition or class-end timer outside its active occurrence may legitimately show an expired value.

## Wrong Bison continuation is chained

Continuation identity is based on the same underlying base period/class. A short time gap alone is not enough. Adjacent regular classes or Bison blocks mapped to different periods must not chain.

## Docker update loses configuration

Runtime data should never live only inside the container writable layer. Verify SQLite, uploads, backups, and configuration are mounted from persistent host directories or named volumes.

## Useful commands

```bash
cd /opt/classroom-control-hub
docker compose ps
docker compose logs --tail=200
curl -s http://localhost:3000/health
docker inspect classroom-control-hub
```

For host-agent issues:

```bash
systemctl status classroom-control-hub-host-agent
journalctl -u classroom-control-hub-host-agent -n 200 --no-pager
```
