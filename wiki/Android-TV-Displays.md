# Android TV / Google TV Displays

Classroom Control Hub manages Android / Google TV endpoints through wireless ADB and the Classroom Hub Display Agent. The first physically validated endpoint is the Onn 4K Streaming Device on Android 14 (`wayne`, build `UKRB.260113.075.A1`).

## Current architecture

The appliance uses Docker host networking. Classroom Hub is reachable on port 3000; the maintenance agent is loopback-only on `127.0.0.1:3010`. The browser never connects directly to ADB or the maintenance listener. Classroom Hub proxies authenticated management operations to maintenance, which owns ADB.

Persisted Android inventory and ADB state live under `data/android-tv/` and survive container recreation.

## Enrollment vs configuration

Pairing is a one-time trust/bootstrap operation. **Pair & Enroll** creates a stable managed-device identity. Use **Edit** afterward for name, school, building, room, profile and display URL. Routine assignment/content changes never require a new pairing code.

If a device card disappears after a software deployment, first inspect `data/android-tv/devices.json` and verify the maintenance proxy. A blank Managed Displays page or permanent **Checking ADB…** can indicate a Hub-to-maintenance networking problem rather than lost enrollment. Do not re-pair until persistence has actually been checked.

## Display Agent

Package: `org.classroomhub.display`.

Managed Displays reports package/running state and supports installation, configuration, launch, screenshots and administrator remote shell. The tested Onn successfully installs the APK, loads the assigned Classroom Hub display URL fullscreen, and automatically restores the agent/content after reboot.

The UI can show **Starting…** after ADB returns because Android may make the debug transport available slightly before it allows the kiosk activity to run.

## Persistent ADB

The tested Onn Android 14 firmware keeps pairing trust but disables Wireless Debugging during reboot. **Enable Persistent ADB** grants the agent the required secure-setting permission, stores an opt-in boot policy and restores wireless debugging with a fixed managed endpoint on port 5555.

Physical validation passed: reboot -> temporary ADB loss -> Wireless Debugging restored -> `:5555` returned -> Hub reconnected without re-pairing -> Display Agent started -> assigned content returned.

Use persistent ADB only on trusted device-management networks. Do not expose ADB or maintenance port 3010 to the Internet/LAN.

## Fast recovery/status

Managed Displays performs active status refresh while visible and faster bounded polling during reboot. The background policy interval and browser refresh interval are separate. Recovery should show **Recovering…** rather than a stale Online badge, then **Starting…** while the kiosk comes back.

The Hub also attempts agent launch as soon as ADB recovers when the assigned profile requires launch-on-boot, reducing the wait for the normal policy cycle.

## Power behavior

Do not use Android deep sleep as the standard scheduled shutdown method on this Onn. Deep sleep can remove the ADB/network management path. Keep the Android endpoint manageable and separate kiosk/content scheduling from physical panel power. HDMI-CEC/panel power remains a hardware-specific validation item.

## Managed Minimal Mode

For dedicated signage devices:

- **Audit Apps** lists third-party packages;
- **Minimal Mode** reversibly disables third-party packages for user 0 except the Classroom Hub Display Agent;
- **Restore Apps** re-enables them.

This does not uninstall firmware or remove Android/Google TV core packages. Audit each new hardware family before applying it. See `docs/ANDROID-TV-MINIMAL-MODE.md`.

## Host-network troubleshooting

Expected listeners:

```text
0.0.0.0:3000   Classroom Hub
127.0.0.1:3010 maintenance-agent
```

Both containers use host networking. Classroom Hub's maintenance URL is `http://127.0.0.1:3010`. An unauthenticated direct request to maintenance returning `401 Unauthorized` is correct. `ECONNREFUSED 127.0.0.1:3010` from Classroom Hub indicates maintenance is not reachable in the shared host network and should be fixed before touching Android enrollment.

## Validation status

Validated on the Onn Android 14 target: pairing, controls, screenshots, shell, APK installation, agent status/configuration, persistent ADB, reboot recovery, automatic reconnect, automatic agent startup and automatic content restoration. HDMI-CEC/panel power and the final audited Minimal Mode package set remain separate validation items.

See `docs/ANDROID-TV-DISPLAYS.md`, `docs/PERSISTENT-ANDROID-ADB.md`, `docs/ANDROID-TV-SUPPORT-MATRIX.md`, and `docs/ANDROID-TV-MINIMAL-MODE.md` for canonical detail.
