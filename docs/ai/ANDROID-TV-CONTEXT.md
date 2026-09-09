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

## Source map

- `maintenance-agent/android-tv-lib.js`: validation, normalized device/profile model, JSON persistence, persistent-ADB policy metadata and fixed ADB action maps.
- `maintenance-agent/android-tv-extension.js`: Express preloader providing pairing, enrollment, bulk enrollment, discovery, device control, policy execution, screenshots, shell, managed-device updates and agent deployment routes.
- `maintenance-agent/android-tv-persistent-adb.js`: opt-in persistent ADB bootstrap/disable routes. Its `persistentAdb` state must survive `JsonStore` normalization/reload.
- `maintenance-agent/Dockerfile`: retains Debian `adb` as a fallback, but on amd64 installs Google's current Linux Platform Tools and verifies that `adb help` exposes `pair HOST`; this is required for Android 11+ wireless-debugging pairing.
- `public/managed-displays/`: administrator enrollment/control UI. The enrollment form contains only trust/connectivity fields; the per-device Edit dialog owns school/building/room/profile/display URL configuration.
- `agents/android-tv/`: leanback-compatible kiosk/boot APK project (`org.classroomhub.display`).
- `test/android-tv-management.test.js`: model/action/runtime regression tests, including pairing-capable ADB, persistent recovery metadata, and separate enrollment/edit workflow enforcement.
- `docs/ANDROID-TV-DISPLAYS.md`: canonical administrator/architecture documentation.
- `wiki/Android-TV-Displays.md`: operator-facing condensed documentation.

## ADB compatibility

Do not assume the distribution-provided ADB is new enough. Debian Bookworm can provide ADB 29.0.6, which supports classic TCP ADB but does not implement the `adb pair` command required by modern Wireless debugging. The maintenance image therefore installs the current official Google Linux Platform Tools on amd64 and places that `adb` ahead of `/usr/bin/adb`. Image construction fails if the installed ADB does not expose the pairing command. On non-amd64 platforms, pairing support must be explicitly validated before claiming Android wireless enrollment support.

## Persistence

`ANDROID_TV_DATA_ROOT` defaults to `/managed/classroom-hub/data/android-tv`, which maps to the existing writable Hub data volume. The ADB client HOME/ANDROID_USER_HOME is pointed at the same root so pairing keys survive container replacement. `devices.json` contains non-secret inventory/profile data plus recovery policy metadata; protect the directory because it also contains ADB authorization keys and may contain a staged signed APK.

`normalizeDevice()` is the persistence schema boundary. Any field omitted there is discarded during both write and reload. `persistentAdb` therefore has an explicit normalized object (`enabled`, `targetPort`, `bootRestore`, bootstrap/disable timestamps). Future device-policy fields that must survive process/container restart need the same treatment and regression coverage.

## Device lifecycle

`pair -> connect -> probe -> register stable identity -> edit assignment/content -> install/configure agent -> operate/policy schedule -> recover -> replace/remove`

Do not collapse `edit assignment/content` back into enrollment. A technician should never need a new pairing code merely to move a device to another room, rename it, change its profile, or assign a different display receiver URL.

The generic provider must tolerate dynamic IPs/ports. Network endpoint changes update the existing stable device record independently from school/room/content metadata.

## Managed-device edit contract

`PUT /android/devices/:id` is the configuration path for an existing enrollment. The normal UI exposes name, school, building, room, profile and display URL. Host/serial/port are intentionally not editable in the routine assignment dialog because those values belong to transport recovery and enrollment identity. If a future UI adds endpoint repair, keep it as an explicit recovery operation rather than mixing it into normal room/content edits.

After a successful new enrollment, the UI may immediately open Edit as a convenience. That does not change the lifecycle separation: pairing has already completed, and the edit request is a separate API operation.

## Policy executor

The maintenance extension evaluates every enabled device against its assigned profile at a bounded interval. The profile timezone, wake time and sleep time produce a desired awake/asleep state. On a state transition the provider reconnects ADB when possible, wakes and launches the agent during the active window, or sleeps the Android endpoint outside it. Overnight windows are supported. The scheduler is intentionally idempotent and keeps per-process transition state so it does not flood endpoints with repeated key events.

This controls the Android endpoint. It does not guarantee physical television/projector panel power; HDMI-CEC support remains a separate device capability that must be validated per hardware/firmware combination.

## Agent contract

The Android package is `org.classroomhub.display`. Configuration uses package-scoped broadcast action `org.classroomhub.display.CONFIGURE` with string extra `display_url`. The app renders that URL in an immersive WebView and attempts to launch on boot. OEM/Android background-launch restrictions mean boot launch is best-effort; do not remove ADB launch/recovery or the policy executor.

## Scale-out API

`POST /android/enroll/bulk` supports bounded batch enrollment of up to 100 explicit devices. `GET /android/adb/devices` reports endpoints already visible to the ADB server. Do not turn this into unrestricted subnet scanning; future discovery must be constrained to administrator-configured management networks.

Bulk staging should preserve the same lifecycle rule as the GUI: bootstrap/register first, then apply site/room/profile/content metadata by stable device ID. This makes replacement, reassignment and district-scale templates possible without coupling configuration to temporary pairing codes.

## Future extensions

Preferred next additions are richer capability discovery, certificate/token-based agent heartbeat/command channel, signed release/update rings, constrained network discovery, USB batch bootstrap through the native host agent, explicit display/content selectors, and HDMI-CEC capability adapters. These should extend the provider contract rather than adding Onn-specific branches.
