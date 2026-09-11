# AI Maintainer Context — Android Agent Artifact Pipeline

Read this before changing Android Display Agent build, staging, install, update or recovery behavior.

## Non-negotiable invariant

`data/android-tv/RoomGoblin-Display-Agent.apk` is not an operator-managed arbitrary file. It must represent the verified APK corresponding to the Android source compiled into the currently deployed maintenance image.

Do not reintroduce instructions that tell operators to manually copy an APK into the staging path as the normal update mechanism.

## Build/stage lifecycle

The normal `maintenance-agent` Dockerfile owns the Android artifact pipeline:

1. its `android-agent-build` stage compiles `agents/android-tv/` from the same repository build context as the appliance;
2. that stage verifies the package identity and version and emits an unsigned release APK plus non-secret build metadata;
3. the final maintenance image carries that unsigned APK, metadata, `apksigner`, and `keytool`;
4. `android-tv-agent-artifact.js` runs at maintenance startup before the HTTP listener;
5. it verifies the bundled APK digest and metadata, creates/reuses the appliance signing identity, signs and verifies the APK, then stages APK + metadata under the Android data root;
6. a staged artifact is considered current only when its version and `bundleSha256` match the Android build embedded in the running maintenance image and its signed APK SHA-256 is valid.

Maintenance startup must fail rather than silently serve a stale, mismatched or unverifiable APK as current.

Both the supported installer and verified application updater already rebuild the maintenance image, so no separate Android builder service or host Android SDK workflow is required.

## Signing invariant

Android package updates require signing continuity. The persistent per-appliance signing material lives outside application data at `/etc/classroom-control-hub/android-agent-signing` and is mounted only into maintenance at `/signing`.

It must never be committed to the repository, returned by APIs, printed by diagnostics, mounted into the main application container, or copied into Docker image layers.

The generated keystore password is a secret. Never include it in logs, API payloads, screenshots, docs examples, or assistant responses.

If centralized release signing is implemented later, migration must explicitly preserve Android package-signature continuity or provide a controlled replacement path.

## Legacy signature transition

Pre-pipeline devices may carry an agent signed by a temporary CI/debug identity. A normal in-place install can return `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

Only that specific signature incompatibility may offer the explicit replacement workflow. The administrator must confirm it. Replacement removes only `org.roomgoblin.display`, installs the verified current staged artifact, restores the trusted `WRITE_SECURE_SETTINGS` grant when Persistent ADB is enabled, restores saved RoomGoblin/Agent v2 configuration from the managed-device record, and relaunches the display.

Do not turn arbitrary install failures into automatic uninstall/reinstall behavior.

## Staged artifact API

`GET /android/agent/artifact` must report verified non-secret metadata only: package, version, signed APK SHA-256, bundled unsigned APK SHA-256, signer certificate SHA-256, signing mode/source and stage time. It must recompute the APK SHA-256 and compare the artifact to the bundle in the running maintenance image before declaring it available.

The API must never expose signing-key material or signing passwords.

## Managed Displays UI

The UI must distinguish:

- installed Agent version reported by the device; and
- staged Agent version verified by the Hub artifact endpoint.

If the versions differ, show an update is available. Do not label an old staged binary as a current reinstall. Install/reinstall must use the verified artifact install route rather than the historical generic APK filename route.

## Filesystem and container invariant

The staged APK and metadata stay mode `0660`, shared through GID `10001`. The maintenance container explicitly joins that group while retaining `cap_drop: ALL` and `no-new-privileges`.

The persistent signing mount is separate from application data. Do not fix access problems with `chmod 777`, world-readable staging, privileged containers, Docker socket access, or broad Linux capabilities.

## Onn Android 14 diagnostic invariant

The existing physical-device rule remains mandatory: do not use or recommend `dumpsys package` on the validated Onn Android 14 `wayne` target because it can hang. Prefer `pm path`, `pm list packages`, `pidof`, Agent Status/Capabilities and other direct bounded commands.
