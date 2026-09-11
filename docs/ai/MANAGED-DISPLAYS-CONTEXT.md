# AI context: Managed Displays

Use this file when changing Android / Google TV management or controller navigation.

## Invariants

1. `/managed-displays/` is an administrator surface for Android/Google TV enrollment, inventory, assignment, ADB actions, agent lifecycle, screenshots and shell.
2. Classroom Overview must expose a same-origin **Managed Displays** link beside its **Refresh** control.
3. Stored Android device/profile inventory and ADB transport availability are independent. A 503 ADB status response can still contain useful inventory; do not erase or hide that inventory solely because `adb version` failed.
4. An unreadable or malformed `data/android-tv/devices.json` is an error state, not an empty inventory. Never catch inventory read/parse failures and silently return `devices: []`.
5. The host-side `data/android-tv/` directory must be `root:10001` with mode `2770`; an existing `devices.json` must be `root:10001` with mode `0660`. Installer, GUI updater and rollback paths must normalize these permissions before maintenance starts.
6. When ADB is down, metadata Edit may remain available, but pairing, remote shell and device commands must be disabled until transport recovers.
7. Long ADB stderr belongs in a bounded detail element, not in the compact health pill.
8. ADB persistent client keys belong at `/managed/classroom-hub/data/android-tv/.android` and are supplied by the named volume `classroom-control-hub-android-adb` through `docker-compose.override.yml`.
9. Do not solve ADB key write failures with `privileged: true`, broad `cap_add`, world-writable Hub data, or ephemeral keys. Preserve the base maintenance container's read-only root and dropped-capability boundary.
10. Changing Compose mounts requires live container recreation. Source/CI success is not evidence that the running appliance has the mount.
11. Display Agent installation and running state are separate. Use `pm path org.roomgoblin.display` as the authoritative installed check and `pidof org.roomgoblin.display` as the running check. Do not place `dumpsys package` in the critical status path; the validated Onn Android 14 device can block on that command while the package is installed and running.
12. Optional package metadata probes must be bounded and may enrich status, but failure or timeout must never downgrade a confirmed installed/running state to **Not installed**.
13. Keep `test/managed-displays-remediation.test.js`, `test/managed-displays-regression.test.js`, `docs/MANAGED-DISPLAYS-RECOVERY.md`, and `wiki/Managed-Displays-Recovery.md` synchronized with these contracts.

## Live-validated remediation, 2026-09-10

On the Onn 4K Streaming Device (`wayne`, Android 14), the following facts were validated on the live appliance:

- the maintenance container needed recreation before the dedicated `.android` volume appeared;
- the nested volume alone was insufficient when the host `data/android-tv` parent was not traversable by the capability-dropped maintenance process;
- `devices.json` existed and contained the enrolled display even while the UI incorrectly showed `0 devices` because the file was mode `0600` and unreadable to maintenance;
- after normalizing the directory/file permissions, inventory returned without re-pairing;
- `adb shell pm path org.roomgoblin.display` returned the installed APK path and `adb shell pidof org.roomgoblin.display` returned PID `1558` while the UI still showed **Not installed**;
- `dumpsys package org.roomgoblin.display` could hang on the device, proving it is unsuitable for the primary agent-status path.

Treat those findings as regression evidence and preserve them in tests and operator documentation.
