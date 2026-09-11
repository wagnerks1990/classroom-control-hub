# Persistent Android / Google TV ADB

Classroom Control Hub can optionally bootstrap persistent wireless debugging on managed Android TV / Google TV endpoints. This is intended for trusted classroom management networks where administrators require unattended recovery after an Android reboot.

## Why this exists

Some Android 14 / Google TV firmware keeps the host pairing authorization across reboot but disables the **Wireless debugging** toggle and may randomize the secure ADB connection port. That behavior breaks unattended management even though the device remains paired.

The Classroom Hub Display Agent therefore requests `android.permission.WRITE_SECURE_SETTINGS`. The permission is not granted automatically by Android; Classroom Hub grants it once through an already-authorized ADB session during administrator bootstrap.

When the persistent-ADB policy is enabled, the agent records that policy and on `LOCKED_BOOT_COMPLETED`, `BOOT_COMPLETED`, or package replacement attempts to restore:

```text
development_settings_enabled = 1
adb_wifi_enabled = 1
```

The boot receiver is direct-boot aware and the agent stores its management policy in device-protected preferences. This allows management restoration to begin before the normal application boot phase when firmware permits it. The kiosk activity itself still launches at normal `BOOT_COMPLETED`/package replacement to avoid depending on WebView availability during locked boot.

During bootstrap, the maintenance service also asks ADB to switch the current session to the administrator-selected fixed TCP port (default `5555`) and updates the managed device record to that endpoint.

## Administrator workflow

1. Pair/enroll the device normally through **Managed Displays**.
2. Install the Classroom Hub Display Agent.
3. Confirm the card reports the agent as installed.
4. Select **Enable Persistent ADB**.
5. Confirm the security warning.
6. Classroom Hub grants `WRITE_SECURE_SETTINGS`, stores the agent policy, enables wireless debugging, switches ADB to the fixed port, reconnects, and records the fixed endpoint.
7. Configure the assigned display URL.
8. Reboot the device and validate that wireless debugging, the fixed ADB endpoint, the Display Agent, and assigned content return without manual intervention.

The device must be online for the one-time bootstrap because the secure permission grant is performed through the existing authorized ADB transport.

## Reboot recovery behavior

A persistent-ADB device is expected to be temporarily unreachable during Android startup. The UI must not treat the first failed ADB probe as a permanent failure.

After a managed reboot, Managed Displays enters **Recovering…** and now probes at a short bounded interval rather than waiting on the normal 60-second policy cycle. Once ADB returns, the Hub immediately checks the Display Agent. If the agent is installed, assigned a display URL, and its profile permits launch-on-boot, Classroom Hub requests an immediate launch and shows **Starting…** while it verifies the process.

The normal Managed Displays page also refreshes live status while visible, so the card does not depend only on the background policy interval to reflect changes.

A successful recovery is defined as the same managed-device identity returning online without a new pairing code, followed by the configured display agent returning Running. The physical Onn Android 14 validation completed this lifecycle successfully: the device rebooted, Wireless Debugging was temporarily unavailable, the agent restored it, `172.16.127.138:5555` returned, Classroom Hub reconnected without re-pairing, and the assigned Classroom Hub display content loaded automatically.

The recovery wait remains bounded. If the endpoint does not return within the configured window, the administrator receives the final connection error rather than an indefinite spinner.

## Security

Persistent ADB is intentionally **opt-in**. ADB is powerful administrative access and must not be exposed to untrusted networks.

Recommended controls:

- Use a dedicated AV/device-management VLAN.
- Permit ADB only from the Classroom Hub management host/network.
- Block the ADB TCP port at inter-VLAN and Internet boundaries.
- Do not enable persistent ADB on guest/public Wi-Fi.
- Restrict Classroom Hub maintenance and remote-shell capabilities to trusted administrators.
- Revoke device authorization and disable the persistent policy when a display leaves management.

The Hub's browser never talks directly to ADB. Commands continue through the authenticated maintenance proxy and maintenance service.

## Failure modes

If firmware ignores or overwrites `adb_wifi_enabled` after boot, persistent restoration may fail even with `WRITE_SECURE_SETTINGS`. Treat this as a hardware/firmware capability and record it in the support matrix.

If the fixed TCP port does not survive reboot, boot-restored Wireless Debugging still improves recovery, but the current secure port may need discovery before Classroom Hub can issue `adb tcpip <fixed-port>` again. Host-side mDNS discovery is the preferred fallback because Docker bridge networking may not receive LAN multicast advertisements.

A temporary ADB or agent-status failure immediately after reboot is not by itself a persistent-ADB failure. Wait through the bounded recovery/startup period before diagnosing the device as offline.

## Validation checklist

For every supported device/firmware combination record:

- Agent installed and launchable.
- `WRITE_SECURE_SETTINGS` grant succeeds.
- Persistent policy stored in device-protected storage.
- Wireless Debugging restored during reboot without manual Developer Options changes.
- Fixed ADB port behavior after boot.
- Bounded recovery UI behaves correctly without premature failure alerts.
- Reconnect without re-pairing.
- Agent automatically returns Running.
- Assigned display URL loads automatically.
- Remote controls, screenshot, shell, and agent launch remain functional after recovery.

## Related source

- `agents/android-tv/app/src/main/AndroidManifest.xml`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/HubStorage.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/BootReceiver.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/ConfigReceiver.java`
- `maintenance-agent/android-tv-persistent-adb.js`
- `public/managed-displays/app.js`
- `docs/MANAGED-ANDROID-MINIMAL-MODE.md`

## Design reference

The no-root boot-restoration approach was informed by the MIT-licensed `mouldybread/adb-auto-enable` project. Classroom Hub implements its own management flow and security boundary rather than bundling that application as a runtime dependency.
