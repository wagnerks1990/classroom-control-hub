# AI Maintainer Context — Persistent Android ADB

Read this with `docs/ai/ANDROID-TV-CONTEXT.md` before changing persistent Android management.

## Intent

Persistent ADB is an optional recovery feature for Android/Google TV firmware that preserves pairing authorization but disables Wireless Debugging or changes the secure ADB port after reboot.

## Invariants

1. Persistent ADB is opt-in and administrator-controlled.
2. The Display Agent may request `WRITE_SECURE_SETTINGS`, but the permission must be bootstrapped through an already-authorized ADB session; never assume it is granted by installation.
3. Boot restoration may set only the Android developer/wireless-debugging settings needed for the policy. Do not silently enable unrelated developer settings.
4. The default fixed ADB port is `5555`, but treat it as policy data and validate it as a bounded TCP port.
5. Never expose maintenance-agent HTTP or ADB ports to untrusted networks.
6. Device records must show whether persistent ADB is enabled and which target port is configured.
7. Reboot is asynchronous. A transport disconnect during reboot is expected and must not be reported as a failed reboot.
8. A known persistent-ADB device may be unreachable during normal Android startup. UI/status logic must use a bounded recovery window rather than surfacing the first failed probe as a terminal error. Current Managed Displays behavior waits up to 90 seconds after reboot and uses a shorter bounded recovery path for manual Status checks.
9. Recovery must remain bounded. Never replace the timeout with an infinite spinner or unbounded polling loop.
10. Firmware behavior wins over assumptions. If a device resets `adb_wifi_enabled` despite the grant, record that hardware/build as unsupported for unattended persistent ADB.
11. Successful unattended recovery means the same stable managed-device identity returns online without a new pairing code. IP/port transport data may change independently of the stable identity.

## Source map

- `agents/android-tv/app/src/main/AndroidManifest.xml`: declares the secure-settings permission requested for bootstrap.
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/BootReceiver.java`: restores wireless debugging at boot when policy is enabled.
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/ConfigReceiver.java`: persists policy state and applies it immediately when possible.
- `maintenance-agent/android-tv-persistent-adb.js`: grants the permission, applies settings, switches the current transport to a fixed port, and updates inventory.
- `public/managed-displays/app.js`: administrator bootstrap control, agent-state rendering and bounded reboot/status recovery polling.
- `docs/PERSISTENT-ANDROID-ADB.md`: canonical operator/architecture documentation.

## Physical validation note

The first Onn Android 14 test demonstrated the expected timing race: immediately after reboot the ADB endpoint was unavailable, then the Display Agent restored Wireless Debugging and the fixed `:5555` endpoint returned. Classroom Hub reconnected without re-pairing. Treat that temporary boot gap as normal recovery behavior, not as proof of failure.

## Reference implementation note

The strategy was informed by the MIT-licensed `mouldybread/adb-auto-enable` project. Classroom Hub does not depend on that APK at runtime; preserve attribution in the canonical documentation if this design remains in use.
