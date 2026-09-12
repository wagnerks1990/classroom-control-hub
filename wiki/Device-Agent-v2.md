# Device Agent v2

Device Agent v2 is the next-generation Android / Google TV management layer for RoomGoblin.

It keeps the existing `org.roomgoblin.display` package identity and existing Managed Displays enrollment records, but changes management from **ADB-only** to a dual-channel design:

- authenticated Agent management over the LAN for normal health/control,
- ADB for privileged recovery and bootstrap.

The first v2 build is deliberately a capability-discovery build. It reports what the physical device can actually do under stock app permissions, user grants, Accessibility, Device Admin, Device Owner, locally paired ADB, and optional root.

## Auto-start

The foreground Agent service is requested from `LOCKED_BOOT_COMPLETED`, `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, the kiosk activity, and configuration receiver. The kiosk activity is also requested after normal boot. OEM Android TV firmware can still reject background activity launch; the management service must remain alive and report that condition instead of making ADB the only recovery path.

## Agent management channel

Default Agent port: `8765`.

The Hub generates a unique device token during v2 configuration and stores it with the device record. The token is provisioned to the APK through the trusted ADB bootstrap path. Browser clients do not receive the raw token.

The exported configuration receiver requires the platform `android.permission.DUMP` permission, which the ADB shell UID holds but ordinary apps do not. The Agent HTTP listener is bounded to eight client workers, a sixteen-client queue, five-second socket timeouts, bounded headers and a 64 KiB request body.

Current Agent endpoints:

- `GET /v1/status`
- `GET /v1/capabilities`
- `POST /v1/action`

The Hub maintenance agent proxies those endpoints for administrators.

## Stock-device capabilities being tested

- health/heartbeat without ADB,
- network/IP state,
- assigned URL and Agent version,
- launch/reload RoomGoblin kiosk,
- media volume,
- wake request,
- application launch where Android exposes a launcher activity,
- boot persistence.

Optional Android grants expand capability:

- Accessibility: Home, Back, Recents,
- Device Admin: lock/sleep style control,
- overlay/write-settings permissions,
- MediaProjection with required platform consent.

Device Owner is a separate provisioning tier for stronger kiosk/reboot/package policy and is not assumed to be available on already deployed consumer TV hardware.

## Local ADB recovery experiment

Agent v2 includes an experimental first-party local ADB client built on the Apache-2.0 licensing option of `libadb-android`.

Explicit test actions include:

- pair the Agent to local Wireless Debugging,
- discover/connect to the randomized TLS ADB endpoint,
- grant the Agent `WRITE_SECURE_SETTINGS` through its paired local ADB session,
- request `tcpip:<target port>`, normally `5555`,
- restore Android developer/wireless-debugging settings when permission permits.

This is intended to address Android 14+ randomized ADB endpoints and reboot/sleep behavior without requiring root.

## Root / Magisk

Root is optional laboratory testing only. Production RoomGoblin does not require Magisk and does not automate bootloader unlock or rooting.

`root-probe` is explicit. Arbitrary root commands are disabled unless the Hub provisions `allow_root_tools=true` for a lab device.

The referenced 2023 Onn Gen 2 rooting guide is archived and states its method no longer works. Its bootloader-unlock workflow also factory-resets the device. Do not use it as a normal deployment procedure.

## Security

- No unauthenticated Agent control endpoint.
- Per-device Agent tokens stay server-side.
- ADB `:5555` is for trusted/isolated management networks only.
- Root tooling defaults off.
- Optional capability failure must degrade cleanly rather than making the device disappear or reporting false state.

See `docs/DEVICE-AGENT-V2.md` in the repository for the full architecture, research references, capability tiers, and physical-device validation procedure.
