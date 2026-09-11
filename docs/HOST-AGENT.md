# RoomGoblin Native Host Agent

The native Host Agent exists so the Docker maintenance container does not require host PID namespaces, privileged mode, or the Docker socket.

## Standard paths

The standard production application path is:

```text
/opt/classroom-hub
```

The service is:

```text
classroom-hub-host-agent.service
```

The Host Agent listens only on the Unix socket:

```text
/run/classroom-control-hub/host-agent.sock
```

The socket is bind-mounted into the maintenance container. No Host Agent TCP port is opened.

## Responsibilities

The Host Agent provides allowlisted host inventory and lifecycle functions for systemd services, journal logs, Docker inventory and managed-container operations, host health, update/recovery helpers, and cleanup discovery. Docker requests are limited to known RoomGoblin containers, pinned integration images, safe inventory/log actions, and the Hub Compose project. Protected services such as Docker, containerd, SSH, networking, DNS, time synchronization, and the Host Agent itself cannot be stopped or disabled through RoomGoblin.

Application releases run as the separate oneshot unit
`classroom-hub-app-update.service`. The Host Agent validates and writes a
root-only transient request; the runner then resolves an approved semantic
version tag, updates the Git checkout, refreshes the Host Agent, rebuilds the
Compose services, and performs version-aware health verification. A private
repository token is sourced from the encrypted application database and exists
on the host only for the duration of `git fetch`.

All browser requests still pass through the authenticated RoomGoblin backend and Maintenance Agent before reaching the Host Agent.

## Migration verification

A stale systemd unit from an older installation may point at `/opt/classroom-control-hub` or the old `/run/classroom-hub/host-agent.sock`. The current standard is `/opt/classroom-hub` plus `/run/classroom-control-hub/host-agent.sock`.

Verify after every migration or host-agent update:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo journalctl -u classroom-hub-host-agent.service -n 100 --no-pager
sudo test -S /run/classroom-control-hub/host-agent.sock && echo "Host Agent socket OK"
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

Expected conditions:

- systemd reports the Host Agent active/running;
- the process runs `host-agent/server.py` from the intended application checkout;
- `/run/classroom-control-hub/host-agent.sock` exists on the host;
- the same socket is visible inside `classroom-control-hub-maintenance`.

If the socket is missing, correct/reinstall the service unit, run `systemctl daemon-reload`, restart the Host Agent, and then recreate/restart the maintenance container so its bind mount sees the live socket.

## Security boundary

The Unix socket directory should remain root-owned and not be exposed through a public network share or reverse proxy. Do not replace this boundary by granting the main application or maintenance container unrestricted host privileges, and do not restore `/var/run/docker.sock` to the Compose file.
