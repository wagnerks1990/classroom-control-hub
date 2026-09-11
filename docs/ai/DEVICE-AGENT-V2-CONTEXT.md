# AI Context — Device Agent v2

## Purpose

Device Agent v2 is the first-party Android / Google TV management architecture for RoomGoblin. Preserve the existing package ID `org.roomgoblin.display` and existing Managed Displays records while moving normal management away from an ADB-only dependency.

## Non-negotiable architecture

1. **Primary control plane:** authenticated Device Agent channel over the trusted management LAN.
2. **Recovery/elevated plane:** external ADB and experimental locally paired ADB.
3. **Optional elevated tiers:** Accessibility, Device Admin, Device Owner, root/Magisk laboratory profile.
4. A missing optional tier must never make the device disappear, erase its inventory, or falsely report a lower-level capability as unavailable.

## Key files

- `agents/android-tv/app/src/main/java/org/roomgoblin/display/AgentService.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/AgentCapabilities.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/LocalAdbManager.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/AgentAccessibilityService.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/AgentDeviceAdminReceiver.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/RootTools.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/BootReceiver.java`
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/ConfigReceiver.java`
- `maintenance-agent/android-tv-agent-v2.js`
- `public/managed-displays/agent-v2-ui.js`
- `docs/DEVICE-AGENT-V2.md`
- `wiki/Device-Agent-v2.md`
- `test/device-agent-v2.test.js`

## Boot contract

The Agent service is `START_STICKY` and is requested from `LOCKED_BOOT_COMPLETED`, `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `MainActivity`, and `ConfigReceiver`. Foreground kiosk launch is still subject to Android/OEM background-activity restrictions. Do not equate a blocked activity launch with a dead Agent service.

## Authentication contract

The Agent listener defaults to port `8765` and requires `x-classroom-hub-agent-token`. Each device gets a unique random token. Raw tokens are server-side secrets and must not be returned to browser clients. The browser talks only to same-origin Hub/maintenance endpoints.

## Capability-reporting contract

The first v2 build is intentionally broad. Every capability should report its actual tier/state instead of assuming support from Android API level alone. Current tiers:

- native stock app,
- user grant,
- Accessibility,
- Device Admin,
- Device Owner,
- trusted/local ADB,
- optional root.

A capability should be described as permission-required/unsupported/experimental when appropriate. Do not claim ordinary application sandbox code can perform arbitrary shell, unattended screen capture, power-off, silent installation, or reboot unless the required elevated tier has been verified.

## Local ADB contract

`LocalAdbManager` uses `libadb-android` under its Apache-2.0 licensing option. It is experimental and exists to test Android 14+ recovery behavior:

- explicit pairing-code enrollment,
- mDNS discovery/connect,
- self-grant of `WRITE_SECURE_SETTINGS`,
- `tcpip:<target-port>` request.

The Agent channel remains the normal management plane even if local ADB works perfectly. Upstream `libadb-android` itself notes it has not received a security audit.

## Root contract

Root is never a baseline requirement. Do not automate bootloader unlocking, firmware flashing, Magisk installation, or rooting against production devices. `root-probe` must remain explicit. `root-command` must remain disabled unless `allow_root_tools=true` was deliberately provisioned to a lab device.

The known 2023 Onn Gen 2 rooting guide is archived and states that its method no longer works. It also requires a factory reset during bootloader unlock. Treat model/firmware-specific rooting instructions as historical lab research, not deployment automation.

## External research license notes

- `mouldybread/adb-auto-enable`: MIT; behavioral/reference research for boot/local-ADB recovery.
- `nozza87/Auto_ADB`: GPL-3.0; do not copy code into RoomGoblin.
- `MuntashirAkon/libadb-android`: GPL-3.0-or-later OR Apache-2.0; RoomGoblin uses the Apache-2.0 option.
- Magisk: GPL-3.0; not bundled.
- Onn rooting guides: research only; not incorporated.

## Physical validation priority

The Onn Android 14 test device is the source of truth for this feature branch. Validate stock-firmware capabilities first, then optional Accessibility/Device Admin, then local ADB. Root/Device Owner tests are separate so results can be compared without changing the stock baseline.
