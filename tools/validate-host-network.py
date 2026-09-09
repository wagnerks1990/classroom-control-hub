#!/usr/bin/env python3
"""Validate rendered Compose JSON from stdin without printing its secrets.

Run: docker compose config --format json | python3 tools/validate-host-network.py
This is a configuration preflight, not a live socket/port-availability probe.
"""
import ipaddress
import json
import sys


def validate(config):
    services = config.get("services", {})
    for name, service in services.items():
        if service.get("network_mode") != "host":
            raise ValueError(f"{name}: host networking is required")
        if service.get("ports") or service.get("networks"):
            raise ValueError(f"{name}: remove ports/networks when using host networking")
    if config.get("networks"):
        raise ValueError("Remove top-level bridge network definitions")
    ports = {}
    for name in ("classroom-hub", "maintenance-agent"):
        env = services[name]["environment"]
        port = int(env["PORT"])
        if not 1 <= port <= 65535:
            raise ValueError(f"{name}: port is outside 1..65535")
        ports[name] = port
        ipaddress.ip_address(env["BIND_ADDRESS"].strip("[]"))
        if env.get("HUB_NETWORK_MODE") != "host":
            raise ValueError(f"{name}: HUB_NETWORK_MODE must be host")
    if len(set(ports.values())) != len(ports):
        raise ValueError("HUB_PORT and MAINTENANCE_PORT must be different")
    maintenance = services["maintenance-agent"]["environment"]
    if maintenance["BIND_ADDRESS"] != "127.0.0.1":
        raise ValueError("Maintenance must remain loopback-only at 127.0.0.1")
    expected = f"http://127.0.0.1:{ports['maintenance-agent']}"
    if services["classroom-hub"]["environment"]["MAINTENANCE_URL"] != expected:
        raise ValueError("Hub maintenance URL must match the local maintenance listener")


if __name__ == "__main__":
    try:
        validate(json.load(sys.stdin))
    except (ValueError, KeyError, TypeError) as error:
        # Never echo the rendered configuration; it can contain live credentials.
        print(f"Host-network configuration rejected: {error}", file=sys.stderr)
        sys.exit(1)
    print("Host-network configuration OK; check actual host ports before recreation.")
