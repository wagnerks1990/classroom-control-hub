# Classroom Hub Device Agent v2

## Purpose

Device Agent v2 changes Managed Displays from an ADB-dependent design into a dual-control design:

1. **Agent channel** — an authenticated first-party management service runs on the Android / Google TV device and remains usable when external ADB is unavailable.
2. **ADB channel** — external ADB remains the privileged recovery/out-of-band channel. The agent also experiments with a first-party on-device ADB client so it can repair wireless debugging and request a fixed ADB port after reboot.

The package ID remains `org.classroomhub.display`. Existing enrolled device records and display URLs are intentionally retained.

## Persistence invariant

Device Agent v2 enrollment is part of the managed-display inventory schema, not transient UI state. A successfully configured display must persist `agentV2.enabled`, `agentV2.port`, the server-side device token, and `agentV2.configuredAt` in `data/android-tv/devices.json`. Every read/normalize/write cycle must preserve those fields. If the token is malformed, the v2 configuration is rejected rather than silently accepted.

A regression discovered during the first physical Onn Android 14 validation caused `normalizeDevice()` to drop the `agentV2` object immediately after configuration. The UI therefore reported configuration success once, then subsequent status requests returned `Device Agent v2 is not configured for this display`. Regression tests now require v2 enrollment to survive a new `JsonStore` instance and a complete inventory reload.

## First-build philosophy

The first v2 build is a capability-discovery build. It intentionally exposes a broad runtime matrix so physical Android TV hardware can tell us which capabilities are:

- available with ordinary application APIs,
- available after a user-granted Android permission,
- available with Accessibility Service,
- available with legacy Device Admin,
- available only when provisioned as Device Owner,
- available through the locally paired ADB client,
- available only on an optional rooted/Magisk test device,
- blocked by Android/OEM policy.

A feature being present in this experimental build does **not** mean it will remain enabled in production. Production policy will be reduced to the minimum privileges required after physical-device validation.

## Agent service

`AgentService` is a `START_STICKY` foreground service and is started by:

- `LOCKED_BOOT_COMPLETED`,
- `BOOT_COMPLETED`,
- `MY_PACKAGE_REPLACED`,
- `MainActivity`,
- `ConfigReceiver`.

The service listens on the configured LAN port, default `8765`, and requires the per-device `x-classroom-hub-agent-token` header. The token is generated and retained by the Hub maintenance service and is provisioned to the app through the existing trusted ADB configuration operation.

Current endpoints inside the agent are:

- `GET /v1/status`
- `GET /v1/capabilities`
- `POST /v1/action`

The maintenance service proxies these under:

- `/android/devices/:id/agent/v2/status`
- `/android/devices/:id/agent/v2/capabilities`
- `/android/devices/:id/agent/v2/action`
- `/android/devices/:id/agent/v2/health`
- `/android/devices/:id/agent/v2/configure`

The raw per-device token must not be returned to browser clients.

## Capability tiers

### Tier 0 — stock app / no special user grant

Expected to work on normal consumer Android TV firmware:

- boot receiver invocation,
- foreground management service,
- authenticated status/heartbeat endpoint,
- network/IP reporting,
- launch/reload own kiosk activity,
- media volume control,
- short wake-lock based wake request,
- open/launch other launcher-visible applications,
- user-confirmed package installation,
- display content assignment and recovery.

Android/OEM restrictions can still prevent background activity launch in some states. The service must remain independently healthy even if foreground kiosk launch is rejected.

### Tier 1 — ordinary user-granted permissions

Experimental optional grants:

- Accessibility Service — Home, Back, Recents and limited UI navigation when external ADB is unavailable.
- `SYSTEM_ALERT_WINDOW` — overlays where explicitly approved.
- `WRITE_SETTINGS` — ordinary system-setting changes where Android permits them.
- MediaProjection — screen capture only after platform/user consent for each applicable session.
- Device Admin — device lock/sleep-style control through `lockNow()` after explicit administrator activation.

These are not equivalent to Device Owner.

### Tier 2 — trusted ADB bootstrap / locally paired ADB

The existing Hub ADB path can grant `WRITE_SECURE_SETTINGS` once. Device Agent v2 also includes an experimental first-party local ADB client using `libadb-android` under its Apache-2.0 licensing option.

Experimental actions:

- `local-adb-pair` — pair the agent's local ADB identity using an Android pairing port/code.
- `local-adb-connect` — discover/connect to ADB using Android mDNS.
- `local-adb-self-grant` — attempt to grant the agent `WRITE_SECURE_SETTINGS` through its paired local ADB session.
- `local-adb-switch-port` — request `tcpip:<port>` from the locally connected ADB daemon.
- `recover-adb-settings` — enforce `development_settings_enabled=1` and `adb_wifi_enabled=1` once secure-setting permission is present.

This path is intended to solve Android 14+ randomized wireless-debugging ports and the observed condition where the Hub reconnects on a temporary TLS port while the saved management target is `:5555`.

### Tier 3 — Device Owner

Device Owner is the preferred elevated enterprise-management tier when a device can be provisioned that way. Candidate capabilities include:

- durable lock-task/kiosk allowlisting,
- unattended reboot through `DevicePolicyManager`,
- stronger package-management policy,
- silent/update workflows depending on Android/OEM implementation,
- tighter restriction/control of device settings.

Consumer devices generally require provisioning before normal setup and may require a factory reset to become Device Owner. The Hub must never assume Device Owner is available on an already-deployed device.

### Tier 4 — optional root/Magisk laboratory profile

Root is **not** a production requirement. Root/Magisk remains research-only for comparing the elevated-control ceiling on sacrificial hardware. The production Agent v2 control plane must not expose arbitrary root command execution.

Potential root-only capabilities to study separately include power control, deeper package/system inspection, input injection, privileged settings, remapping, and recovery hooks. These are not appropriate baseline assumptions for school-wide deployments.

## Research references and decisions

### `mouldybread/adb-auto-enable`

This MIT-licensed project is the closest external reference to our Android 14+ ADB recovery problem. Its documented design:

- starts a foreground service from boot,
- re-enables `adb_wifi_enabled`,
- waits for network/system stabilization,
- discovers the randomized ADB endpoint with mDNS and a socket-scan fallback,
- locally connects to adbd,
- sends `tcpip:<target-port>`,
- stores ADB authentication keys locally.

Classroom Hub is implementing its own code and management protocol. The project is used as behavioral research, not as a bundled dependency.

### `nozza87/Auto_ADB`

Useful architectural reference for local pairing and persistent legacy ADB. The project itself is GPL-3.0, so Classroom Hub does not copy or incorporate its source.

### `MuntashirAkon/libadb-android`

The library exposes local TCP/TLS discovery, pairing and ADB streams and is dual-licensed GPL-3.0-or-later **or Apache-2.0**. Classroom Hub uses the Apache-2.0 licensing option for the dependency. The upstream project notes that it has not received a security audit, so the local ADB code remains an experimental/recovery feature and must not replace the authenticated Agent channel as the normal control plane.

### Magisk

Magisk can provide root capabilities but changes the device trust/update/support model. It is GPL-3.0 and is not embedded into Classroom Hub.

### Onn rooting guides

The Gen 1/2021 guide requires bootloader unlock and flashing a Magisk-patched boot image. Bootloader unlock changes device state and normally resets the device.

The referenced 2023 Gen 2 guide is archived and explicitly states its method no longer works when last tested. It also documents a factory reset during bootloader unlock. It is therefore unsuitable as a production deployment mechanism.

### Fermata Android 14 discussions

Fermata discussions are useful as evidence that Android 14 tightened behavior around non-standard application integration and that workarounds may depend on privileged/root/proxy mechanisms. They are not directly an Android TV management implementation and no Fermata code is used by Classroom Hub.

## Security invariants

1. The Agent management listener is authenticated. No unauthenticated command endpoint is allowed.
2. Per-device tokens remain server-side in the browser architecture. Browser clients receive only redacted configuration state.
3. Device Agent v2 enrollment fields must survive every inventory normalization/read/write cycle.
4. External ADB and local ADB are recovery/elevated channels, not the primary application control plane.
5. Capability probes must report failure/permission-required truthfully rather than silently presenting a capability as available.
6. A device must remain usable if any optional tier is unavailable.
7. ADB port `5555` must only be enabled on a trusted/isolated management network and retain Android ADB authentication.
8. Rooting/unlocking must never be automated against production devices.

## Physical-device validation plan

For each test build, record results from `/agent/v2/capabilities` and explicit actions on the Onn Android 14 device.

Baseline stock-device sequence:

1. install/reinstall v2 APK,
2. configure v2 token/port and verify the configuration survives an inventory reload,
3. confirm Agent HTTP health from the Hub,
4. disable external ADB or stop relying on the temporary TLS port,
5. verify Agent status, reload, wake, volume and available navigation still work,
6. reboot and verify foreground Agent service returns automatically,
7. verify kiosk activity returns automatically or reports OEM background-launch restriction,
8. pair the local ADB identity once,
9. attempt local ADB discovery/self-grant/fixed-port switch,
10. reboot and determine whether local ADB can restore `:5555` without manual Wireless Debugging intervention.

Optional elevated tests are then run independently for Accessibility, Device Admin and Device Owner. Root testing remains separate research on sacrificial hardware. Results belong in the capability matrix rather than being assumed from API documentation.
