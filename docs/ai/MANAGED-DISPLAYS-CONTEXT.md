# AI context: Managed Displays

Use this file when changing Android / Google TV management or controller navigation.

## Invariants

1. `/managed-displays/` is an administrator surface for Android/Google TV enrollment, inventory, assignment, ADB actions, agent lifecycle, screenshots and shell.
2. Classroom Overview must expose a same-origin **Managed Displays** link beside its **Refresh** control.
3. Stored Android device/profile inventory and ADB transport availability are independent. A 503 ADB status response can still contain useful inventory; do not erase or hide that inventory solely because `adb version` failed.
4. When ADB is down, metadata Edit may remain available, but pairing, remote shell and device commands must be disabled until transport recovers.
5. Long ADB stderr belongs in a bounded detail element, not in the compact health pill.
6. ADB persistent client keys belong at `/managed/classroom-hub/data/android-tv/.android` and are supplied by the named volume `classroom-control-hub-android-adb` through `docker-compose.override.yml`.
7. Do not solve ADB key write failures with `privileged: true`, broad `cap_add`, world-writable Hub data, or ephemeral keys. Preserve the base maintenance container's read-only root and dropped-capability boundary.
8. Changing Compose mounts requires live container recreation. Source/CI success is not evidence that the running appliance has the mount.
9. Keep `test/managed-displays-regression.test.js`, `docs/MANAGED-DISPLAYS-RECOVERY.md`, and `wiki/Managed-Displays-Recovery.md` synchronized with these contracts.
