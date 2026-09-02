# Classroom Control Hub Native Host Agent

Classroom Control Hub 1.0.0-alpha.33 introduces a native host-management agent so the Docker maintenance container does not require host PID namespaces or privileged mode.

The service runs as `classroom-control-hub-host-agent.service` and listens only on the Unix socket `/run/classroom-control-hub/host-agent.sock`. The socket is bind-mounted into the maintenance container. No TCP port is opened.

The Host Agent provides allowlisted host inventory and lifecycle functions for systemd services, journal logs, host health, and cleanup discovery. Protected services such as Docker, containerd, SSH, networking, DNS, time synchronization, and the Host Agent itself cannot be stopped or disabled through Classroom Control Hub.

All browser requests still pass through the authenticated Classroom Control Hub backend and Maintenance Agent before reaching the Host Agent.
