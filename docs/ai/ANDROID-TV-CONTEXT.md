# AI Maintainer Context — Android / Google TV Displays

Read this before changing managed-display code.

## Intent

Android TV management is a reusable device-provider subsystem. Onn Google TV is the first hardware validation target but MUST NOT become a product-specific backend abstraction.

## Security invariants

1. The main Classroom Hub application container remains read-only/unprivileged and does not execute ADB.
2. Wireless ADB executes in the existing unprivileged maintenance container and is reachable from the browser only through the authenticated `/api/v1/maintenance/*` proxy.
3. Never publish the maintenance container port or Android ADB ports to untrusted networks.
4. Routine actions and scheduled policy actions must continue using fixed argument arrays. Do not convert wake/reboot/app-control operations into interpolated shell strings.
5. `/android/devices/:id/shell` is intentionally full administrator recovery access. Keep input bounded, require existing maintenance authorization, and never silently expose it to lower-privilege classroom roles.
6. APK installation paths must remain constrained beneath the managed Android TV data directory.
7. Device identity is the stable Classroom Hub ID, not the IP address or ADB TCP endpoint.
8. Enrollment and configuration are separate lifecycle operations. Pairing/ADB enrollment establishes trust and stable identity once. School/building/room/profile/display URL changes MUST use the managed-device update path and MUST NOT trigger re-pairing.
9. Recovery metadata such as `persistentAdb` is part of the persisted normalized device model. Do not add operational policy fields only to call sites; if `JsonStore.upsertDevice()` must preserve them, `normalizeDevice()` must explicitly normalize them.
10. Native Sendspin configuration belongs to the managed Android agent and must never expose the stored Music Assistant API token. Sendspin audio transport is separate from Music Assistant API authentication.

## Source map

- `maintenance-agent/android-tv-lib.js`: validation, normalized device/profile model, JSON persistence, persistent-ADB policy metadata and fixed ADB action maps.
- `maintenance-agent/android-tv-extension.js`: Express preloader providing pairing, enrollment, bulk enrollment, discovery, device control, policy execution, screenshots, shell, managed-device updates and agent deployment routes.
- `maintenance-agent/android-tv-persistent-adb.js`: opt-in persistent ADB bootstrap/disable routes. Its `persistentAdb` state must survive `JsonStore` normalization/reload.
- `maintenance-agent/android-tv-agent-v2.js`: Agent v2 authenticated HTTP bridge and lifecycle/configuration routes.
- `maintenance-agent/Dockerfile`: retains Debian `adb` as a fallback, but on amd64 installs Google's current Linux Platform Tools and verifies that `adb help` exposes `pair HOST`; this is required for Android 11+ wireless-debugging pairing.
- `public/managed-displays/`: administrator enrollment/control UI. The enrollment form contains only trust/connectivity fields; the per-device Edit dialog owns school/building/room/profile/display URL configuration. Agent v2 UI also exposes guided Accessibility/Device Admin activation and native Sendspin controls.
- `agents/android-tv/`: leanback-compatible kiosk/boot APK project (`org.roomgoblin.display`).
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/KioskWatchdog.java`: process-level always-on/self-heal loop; this must remain independent from `MainActivity`.
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/NativeSendspinManager.kt`: persistent native Music Assistant Sendspin client owned by the agent process.
- `agents/android-tv/app/src/main/java/org/roomgoblin/display/AndroidPcmSendspinPlayer.kt`: Android `AudioTrack` sink for the initial PCM baseline.
- `test/android-tv-management.test.js` and `test/device-agent-v2.test.js`: managed-device, recovery and Agent v2 regression coverage.
- `docs/ANDROID-TV-DISPLAYS.md`: canonical administrator/architecture documentation.
- `docs/ANDROID-TV-NATIVE-SENDSPIN.md`: native Android Sendspin design and physical test plan.
- `wiki/Android-TV-Displays.md` and `wiki/Android-TV-Native-Sendspin.md`: operator-facing condensed documentation.

## ADB compatibility

Do not assume the distribution-provided ADB is new enough. Debian Bookworm can provide ADB 29.0.6, which supports classic TCP ADB but does not implement the `adb pair` command required by modern Wireless debugging. The maintenance image therefore installs the current official Google Linux Platform Tools on amd64 and places that `adb` ahead of `/usr/bin/adb`. Image construction fails if the installed ADB does not expose the pairing command. On non-amd64 platforms, pairing support must be explicitly validated before claiming Android wireless enrollment support.

### Onn Android 14 command safety — mandatory

The validated Onn 4K Streaming Device running Android 14 (`wayne`) has repeatedly shown that `dumpsys package <package>` can block or hang indefinitely. **Do not use `dumpsys package` for routine package presence, version, process, health, or agent-status checks on this target. Do not recommend it to operators.**

Preferred bounded/direct commands are:

- package installed/path: `adb -s <serial> shell pm path org.roomgoblin.display`
- process running: `adb -s <serial> shell pidof org.roomgoblin.display`
- platform/device identity: targeted `getprop` calls
- package receiver discovery: `cmd package query-receivers ...`
- Device Owner/Profile Owner state: `dpm list-owners` or `cmd device_policy list-owners`
- service/listener state: targeted `ss`, agent HTTP health, or direct API probes

If a diagnostic has no direct command and `dumpsys` is unavoidable, it MUST be bounded with a short timeout and must never be placed on a primary UI/status path. Full unbounded `dumpsys package` is a known-bad diagnostic on the validated Onn Android 14 target.

This is an AI/operator invariant. Future troubleshooting instructions, generated commands, tests, and UI health checks must prefer the direct commands above and must not regress to `dumpsys package`.

## Persistence

`ANDROID_TV_DATA_ROOT` defaults to `/managed/classroom-hub/data/android-tv`, which maps to the existing writable Hub data volume. The ADB client HOME/ANDROID_USER_HOME is pointed at the same root so pairing keys survive container replacement. `devices.json` contains non-secret inventory/profile data plus recovery policy metadata; protect the directory because it also contains ADB authorization keys and may contain a staged signed APK.

`normalizeDevice()` is the persistence schema boundary. Any field omitted there is discarded during both write and reload. `persistentAdb` therefore has an explicit normalized object (`enabled`, `targetPort`, `bootRestore`, bootstrap/disable timestamps). Future device-policy fields that must survive process/container restart need the same treatment and regression coverage.

The Android agent stores its own Agent v2 token, display URL, persistent-ADB policy, native Sendspin client ID/endpoint/name and Sendspin client settings in device-protected SharedPreferences via `HubStorage`. This allows the foreground agent to recover before normal credential-protected user storage is fully available.

## Device lifecycle

`pair -> connect -> probe -> register stable identity -> edit assignment/content -> install/configure agent -> operate/policy schedule -> recover -> replace/remove`

Do not collapse `edit assignment/content` back into enrollment. A technician should never need a new pairing code merely to move a device to another room, rename it, change its profile, or assign a different display receiver URL.

The generic provider must tolerate dynamic IPs/ports. Network endpoint changes update the existing stable device record independently from school/room/content metadata.

## Managed-device edit contract

`PUT /android/devices/:id` is the configuration path for an existing enrollment. The normal UI exposes name, school, building, room, profile and display URL. Host/serial/port are intentionally not editable in the routine assignment dialog because those values belong to transport recovery and enrollment identity. If a future UI adds endpoint repair, keep it as an explicit recovery operation rather than mixing it into normal room/content edits.

After a successful new enrollment, the UI may immediately open Edit as a convenience. That does not change the lifecycle separation: pairing has already completed, and the edit request is a separate API operation.

## Always-on/self-healing kiosk contract

The classroom kiosk profile is intended to remain visible and manageable continuously unless an explicit policy says otherwise.

Agent `0.3.0-agent-v2` adds a process-level `KioskWatchdog` owned by `AgentService`. The watchdog must remain independent of the WebView activity so leaving or destroying `MainActivity` cannot disable recovery. It holds an always-on display wake lock, while `MainActivity` also uses `FLAG_KEEP_SCREEN_ON`. When the activity is no longer resumed, the watchdog waits a 20-second grace period and checks every 10 seconds, targeting kiosk relaunch within 30 seconds. Background-activity launch restrictions remain OEM-controlled, so the watchdog retries rather than assuming one launch request succeeded.

Boot and `MY_PACKAGE_REPLACED` continue to start the durable foreground service and request display launch. Physical validation must include: reboot, deliberate Home/exit, process restart, network interruption and WebView reload.

Do not make Device Admin a prerequisite for always-on operation. Device Admin is a separate optional capability used for lock/sleep. Always-on kiosk reliability must function without Device Admin.

## Accessibility / global navigation

`Home`, `Back` and `Recents` through Agent v2 require `AgentAccessibilityService`. When accessibility is disabled, those actions correctly return `performed:false`; do not misreport them as successful. Managed Displays exposes **Enable Accessibility**, which launches a first-party foreground helper and then Android Accessibility settings. The operator must explicitly enable Classroom Hub control fallback unless a future managed-provisioning workflow grants/configures it.

## Device Admin

The tested Onn state has returned success from shell-oriented activation attempts while `DevicePolicyManager.isAdminActive()` remained false. Treat the application capability result as authoritative. Agent `0.3.0-agent-v2` keeps `DeviceAdminActivationActivity` alive while Android's `ACTION_ADD_DEVICE_ADMIN` approval activity is active and uses `startActivityForResult`; this revised path is not physically validated until the Onn actually presents the approval UI and capabilities report `deviceAdminActive:true` afterward.

Do not use broad `dumpsys device_policy` as a routine validator on this firmware.

## Native Music Assistant / Sendspin contract

Native Sendspin is deliberately separate from the WebView. `AgentService` owns `NativeSendspinManager`; the visual kiosk may reload or self-heal without intentionally interrupting audio.

The implementation pins the Apache-2.0 `sendspin-jvm` library to `v0.3.4`. The initial Android sink advertises only PCM 48 kHz, stereo, 16-bit and outputs through streaming Android `AudioTrack`. Do not advertise FLAC, Opus or other encoded formats until the corresponding decoder exists and is physically tested.

Agent status includes native Sendspin state and buffer/drop diagnostics. Managed Displays supports configure/status/reconnect actions. The normal external Music Assistant Sendspin endpoint is `ws://<music-assistant-host>:8927/sendspin`. The endpoint must be directly reachable from the managed TV network.

Native Sendspin remains **implementation-complete but hardware-unvalidated** until CI builds the APK and the Onn test proves player registration, HDMI audio, volume behavior, WebView-independent playback, network reconnect and reboot recovery. Do not describe sample-accurate multiroom synchronization as validated until measured on hardware.

Future fleet work should propagate the Hub's database-backed Music Assistant `sendspinHost`/`sendspinPort` configuration to agents automatically rather than requiring per-device URL entry.

## Policy executor

The maintenance extension evaluates every enabled device against its assigned profile at a bounded interval. Older profiles may contain wake/sleep schedules. For dedicated always-on classroom kiosks, avoid scheduling Android deep sleep because sleeping can drop the network/ADB management path. Treat panel power, content schedule and Android deep sleep as separate policies.

This controls the Android endpoint. It does not guarantee physical television/projector panel power; HDMI-CEC support remains a separate device capability that must be validated per hardware/firmware combination.

## Agent contract

The Android package is `org.roomgoblin.display`. Configuration uses package-scoped broadcast action `org.roomgoblin.display.CONFIGURE` with string extra `display_url`. The app renders that URL in an immersive WebView. Agent v2 provides the durable foreground process, authenticated LAN control API, always-on kiosk watchdog, persistent ADB policy and native Sendspin subsystem.

OEM/Android background-launch restrictions still apply. Keep ADB recovery and Hub-side policy/launch assistance; do not assume a normal third-party Android application can achieve Device Owner/lock-task behavior without managed provisioning.

## Scale-out API

`POST /android/enroll/bulk` supports bounded batch enrollment of up to 100 explicit devices. `GET /android/adb/devices` reports endpoints already visible to the ADB server. Do not turn this into unrestricted subnet scanning; future discovery must be constrained to administrator-configured management networks.

Bulk staging should preserve the same lifecycle rule as the GUI: bootstrap/register first, then apply site/room/profile/content metadata by stable device ID. This makes replacement, reassignment and district-scale templates possible without coupling configuration to temporary pairing codes.

## Future extensions

Preferred next additions are automatic Sendspin configuration propagation from the Hub integration record, hardware-measured audio latency/output-delay calibration, richer capability discovery, signed release/update rings, constrained network discovery, USB batch bootstrap through the native host agent, explicit display/content selectors, proper Android Device Owner provisioning, strict lock-task kiosk mode, and HDMI-CEC capability adapters. These should extend the provider contract rather than adding Onn-specific branches.
