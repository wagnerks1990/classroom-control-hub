# AI Maintainer Context — Android Agent Artifact Pipeline

Read this before changing Android Display Agent build, staging, install, update or recovery behavior.

## Non-negotiable invariant

`data/android-tv/ClassroomHub-Display-Agent.apk` is not an operator-managed arbitrary file. It must represent the verified APK built from the current `agents/android-tv/` source for this appliance update lifecycle.

Do not reintroduce instructions that tell operators to manually copy an APK into the staging path as the normal update mechanism.

## Build/stage lifecycle

The Compose one-shot service `android-agent-builder` runs before `maintenance-agent` and:

1. hashes the current Android source tree;
2. reuses the existing staged APK only when source digest and APK SHA-256 still match metadata;
3. otherwise builds the current source in a temporary writable workspace;
4. signs the APK with the appliance's persistent signing identity;
5. verifies package identity, version and signing certificate;
6. stages APK + metadata with group `10001` and mode `0660`.

The maintenance service must not become healthy before this one-shot dependency succeeds.

## Signing invariant

Android package updates require signing continuity. The persistent per-appliance signing material lives outside application data at `/etc/classroom-control-hub/android-agent-signing` and must never be committed to the repository, returned by APIs, printed by diagnostics, or mounted into the main application container.

The generated keystore password is a secret. Never include it in logs, API payloads, screenshots, docs examples, or assistant responses.

If centralized release signing is implemented later, migration must explicitly preserve Android package-signature continuity or provide a controlled replacement path.

## Legacy signature transition

Pre-pipeline devices may carry an agent signed by a temporary CI/debug identity. A normal in-place install can return `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

Only that specific signature incompatibility may offer the explicit replacement workflow. The administrator must confirm it. Replacement removes only `org.classroomhub.display`, installs the verified current staged artifact, and immediately restores saved Classroom Hub configuration from the managed-device record.

Do not turn arbitrary install failures into automatic uninstall/reinstall behavior.

## Staged artifact API

`GET /android/agent/artifact` must report verified non-secret metadata only: package, version, APK SHA-256, signer certificate SHA-256, signing mode/source and stage time. It must recompute the APK SHA-256 before declaring the artifact available.

The API must never expose signing-key material or signing passwords.

## Managed Displays UI

The UI must distinguish:

- installed Agent version (reported by the device), and
- staged Agent version (reported by the Hub artifact endpoint).

If the versions differ, show an update is available. Do not label an old staged binary as a current reinstall.

## Filesystem invariant

The staged APK and metadata stay mode `0660`, shared through GID `10001`. The maintenance container explicitly joins that group while retaining `cap_drop: ALL` and `no-new-privileges`.

Do not fix access problems with `chmod 777`, world-readable staging, privileged containers, Docker socket access, or broad Linux capabilities.

## Onn Android 14 diagnostic invariant

The existing physical-device rule remains mandatory: do not use or recommend `dumpsys package` on the validated Onn Android 14 `wayne` target because it can hang. Prefer `pm path`, `pm list packages`, `pidof`, Agent Status/Capabilities and other direct bounded commands.
