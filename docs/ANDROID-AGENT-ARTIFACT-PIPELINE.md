# Android Display Agent Artifact Pipeline

## Purpose

Managed Android/Google TV devices must never reinstall an arbitrary historical APK merely because a file named `ClassroomHub-Display-Agent.apk` exists in persistent data.

The appliance now owns the complete build -> sign -> verify -> stage -> install lifecycle for `org.classroomhub.display`.

## Source-of-truth model

The current Android agent source lives under `agents/android-tv/` in the same Classroom Hub checkout as the backend and maintenance layer.

Before the maintenance service becomes healthy, the one-shot Compose service `android-agent-builder` evaluates the Android source tree. If the staged artifact metadata does not match the current source digest, it builds a fresh APK from that exact checkout.

The resulting files are staged at:

- `data/android-tv/ClassroomHub-Display-Agent.apk`
- `data/android-tv/ClassroomHub-Display-Agent.json`

The metadata records package identity, version name/code, source digest, APK SHA-256, signing-certificate SHA-256, signing mode, source and staging time.

## Persistent signing identity

The builder generates a per-appliance Android signing identity the first time it is needed and persists it outside the application data mount under:

`/etc/classroom-control-hub/android-agent-signing`

The directory contains the keystore and its randomly generated password. It must be protected as an appliance secret and included in disaster-recovery planning if already-deployed Android agents are expected to continue accepting in-place updates.

The application container does not mount this signing directory. The short-lived builder receives only the Android source, Android staging directory, and signing directory required for the build.

The builder runs with `no-new-privileges`, all Linux capabilities dropped, and only the shared Android staging GID added. The signing directory remains host-root controlled.

## Why the signing key is persistent

Android requires an update APK to be signed by the same signing identity as the installed package. A newly generated default debug key on every build would therefore make routine upgrades fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

The persistent appliance key gives every subsequent APK built by that appliance the same package-signing identity.

For centrally distributed production releases, an organization-managed release signing identity may replace the per-appliance model later. Never commit a private signing key to the public repository.

## One-time legacy signature transition

Devices installed before this pipeline may contain an agent signed by an older temporary CI/debug key. The first update to the appliance-managed signing identity can therefore fail Android signature verification.

The Managed Displays install control handles this explicitly:

1. attempt normal `adb install -r -g`;
2. detect only the Android signature-incompatibility condition;
3. require administrator confirmation;
4. uninstall only `org.classroomhub.display`;
5. install the verified staged APK;
6. immediately restore the saved display URL, Agent v2 token/port, persistent-ADB policy and launch state.

Other install failures do not trigger package replacement automatically.

## Artifact verification

Before staging, the builder verifies:

- an APK was produced;
- package name is exactly `org.classroomhub.display`;
- APK versionCode/versionName match the Gradle configuration;
- `apksigner verify` succeeds;
- signing certificate digest can be read;
- APK SHA-256 is recorded.

The maintenance endpoint `GET /android/agent/artifact` recalculates the staged APK SHA-256 and refuses to mark it available when metadata and APK disagree.

## Managed Displays behavior

Device Agent v2 status now distinguishes the installed agent version from the staged artifact version. A mismatch is presented as an update being available, and the existing Install/Reinstall control is intercepted by the verified artifact installer.

The install path is therefore based on a verified staged artifact rather than an unversioned filename.

## Permission model

The staged APK and metadata are group-readable/writable by GID `10001` with mode `0660`. The maintenance container explicitly joins that supplemental group. This is required because the maintenance container drops `CAP_DAC_OVERRIDE` and must not depend on root bypassing filesystem permissions.

Do not solve staging failures by making APKs world-readable.

## Deployment validation

After an appliance update that changes Android agent source:

1. confirm the `android-agent-builder` service exits successfully;
2. confirm maintenance becomes healthy only afterward;
3. query the staged artifact endpoint and verify the expected version;
4. confirm Managed Displays reports installed vs staged versions separately;
5. install/update the agent;
6. confirm Agent Status reports the staged version;
7. on the first legacy-signature transition only, confirm the replacement warning and automatic reprovisioning behavior;
8. repeat a later agent update and verify it upgrades in-place without another signature transition.

## Recovery

If `/etc/classroom-control-hub/android-agent-signing` is lost, the appliance will create a new signing identity. Existing devices will then require the explicit signature-transition replacement path again.

Restoring only `data/android-tv/ClassroomHub-Display-Agent.apk` is not sufficient for long-term update continuity; preserve the signing directory as well.
