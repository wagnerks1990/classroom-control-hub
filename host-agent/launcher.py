#!/usr/bin/env python3
"""Alpha.71 Host Agent launcher.

Extends the stable Host Agent without duplicating its implementation. Existing
containers discovered on the appliance may be inspected, logged, started,
stopped, restarted, or killed from the authenticated controller. Creating new
containers remains restricted to explicitly supported integration images.
"""
import os
import threading
from pathlib import Path

import server as core

core.VERSION = "1.0.0-alpha.71"

# Supported optional appliance integrations. Keep previous pinned images
# allowlisted so an existing deployment can be adopted or recreated safely,
# while `latest` is available when the administrator explicitly chooses it.
core.MANAGED_CONTAINERS.update({
    "mosquitto",
    "govee2mqtt",
    "music-assistant-server",
    "veyon-webapi",
})
core.MANAGED_IMAGES.update({
    "eclipse-mosquitto:latest",
    "ghcr.io/wez/govee2mqtt:latest",
    "ghcr.io/music-assistant/server:latest",
    "veyon/webapi-proxy:latest",
})

_original_managed_docker = core.managed_docker


def _existing_container_names():
    result = core.run(["docker", "ps", "-a", "--format", "{{.Names}}"], 15, False)
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def managed_docker_with_adoption(args, cwd=""):
    """Permit safe lifecycle/read operations for any existing container.

    Removal and new `docker run` operations still flow through the core
    allowlists. This lets Classroom Control Hub become the appliance control
    plane without exposing an arbitrary root Docker command API.
    """
    if isinstance(args, list) and args:
        verb = str(args[0])
        candidate = ""
        if verb in ("start", "stop", "restart", "kill", "inspect") and len(args) == 2:
            candidate = str(args[1])
        elif verb == "logs" and len(args) >= 2:
            candidate = str(args[-1])
        if candidate and core.DOCKER_NAME_RE.fullmatch(candidate) and candidate in _existing_container_names():
            core.MANAGED_CONTAINERS.add(candidate)
    return _original_managed_docker(args, cwd)


core.managed_docker = managed_docker_with_adoption


def main():
    Path(core.SOCKET_PATH).parent.mkdir(parents=True, exist_ok=True)
    try:
        os.unlink(core.SOCKET_PATH)
    except FileNotFoundError:
        pass
    server = core.UnixHTTPServer(core.SOCKET_PATH, core.Handler)
    os.chmod(core.SOCKET_PATH, 0o660)
    print(f"Classroom Control Hub Host Agent {core.VERSION} listening on {core.SOCKET_PATH}", flush=True)
    if core.APP_UPDATE_REQUEST_FILE.exists():
        def resume_interrupted_update():
            core.run(["systemctl", "start", "--no-block", core.APP_UPDATE_SERVICE], 20, False)
        threading.Timer(2.0, resume_interrupted_update).start()
    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            os.unlink(core.SOCKET_PATH)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    main()
