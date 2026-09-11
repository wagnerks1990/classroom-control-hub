# Android Display Agent Artifact Pipeline

## Purpose

Managed Android/Google TV devices must never reinstall an arbitrary historical APK merely because a file named `RoomGoblin-Display-Agent.apk` exists in persistent data.

The appliance owns the complete build -> sign -> verify -> stage -> install lifecycle for `org.roomgoblin.display`.

## Source-of-truth model

The current Android agent source lives under `agents/android-tv/` in the same RoomGoblin checkout as the backend and maintenance layer.

The normal `maintenance-agent` image build now has an Android build stage. That stage compiles the current `agents/android-tv/` source into an unsigned release APK and verifies its package identity and Gradle version. The unsigned APK and non-secret build metadata are copied into the final maintenance image.

This means the existing supported deployment paths already carry the current Android agent:

- `sudo bash install.sh` builds the current maintenance image;
- the verified application updater builds the current maintenance image;
- rollback/recovery images preserve the maintenance image that was active for that application revision.

No separate host Android SDK installation and no manually copied APK are required.

## Startup signing and staging

The final maintenance image contains the unsigned APK, Android `apksigner`, and Java `keytool`. During maintenance process startup, `android-tv-agent-artifact.js` runs before the HTTP listener becomes available.

It verifies that the bundled unsigned APK SHA-256, package name, versionCode, and versionName match the metadata produced during the image build. It then signs that APK using the appliance's persistent signing identity and stages:

- `data/android-tv/RoomGoblin-Display-Agent.apk`
- `data/android-tv/RoomGoblin-Display-Agent.json`

The staged metadata records package identity, version name/code, unsigned bundle SHA-256, signed APK SHA-256, signing-certificate SHA-256, signing mode, source and staging time.

If the existing staged artifact already matches the current maintenance-image bundle and verifies correctly, it is retained rather than needlessly regenerated.

Maintenance startup fails rather than serving an old or unverifiable APK as current.

## Persistent signing identity

The maintenance service generates a per-appliance Android signing identity the first time it is needed and persists it outside application data under:

`/etc/classroom-control-hub/android-agent-signing`

The Compose mount exposes this host directory only to the maintenance container at `/signing`. It is not mounted into the main RoomGoblin application container.

The directory contains the keystore and a randomly generated password. Neither is committed to Git, returned by an API, or printed by normal diagnostics. Preserve this directory in disaster-recovery planning when already-deployed Android agents must continue accepting in-place updates.

The maintenance container remains hardened with `no-new-privileges` and `cap_drop: ALL`. It receives only the existing supplemental GID `10001` needed for managed artifact storage.

## Why the signing key is persistent

Android requires an update APK to be signed by the same signing identity as the installed package. Generating a new debug key for every build would make routine upgrades fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

The persistent appliance key gives subsequent APKs staged by the same appliance the same package-signing identity.

A centrally managed district/release signing identity may replace the per-appliance model later, but private signing material must never be committed to the public repository.

## One-time legacy signature transition

Devices installed before this pipeline may contain an agent signed by an older temporary CI/debug key. The first update to the appliance-managed signing identity can therefore fail Android signature verification.

The verified Managed Displays install path handles only that specific condition:

1. attempt normal `adb install -r -g`;
2. recognize Android's signature-incompatibility error;
3. require explicit administrator confirmation;
4. uninstall only `org.roomgoblin.display`;
5. install the verified staged APK;
6. restore `WRITE_SECURE_SETTINGS` through trusted ADB when Persistent ADB is enabled;
7. restore the saved display URL, Agent v2 token/port and persistent-ADB configuration;
8. relaunch the RoomGoblin display activity.

Other installation failures do not trigger automatic uninstall/reinstall behavior.

This is expected to be a one-time transition. Future APKs staged by the same appliance should upgrade normally because their signing identity remains stable.

## Artifact verification API

`GET /android/agent/artifact` reports non-secret artifact state. It recalculates the signed APK SHA-256 and verifies that the staged version and unsigned-bundle digest match the Android build embedded in the running maintenance image.

The response may include:

- package name;
- versionName/versionCode;
- signed APK SHA-256;
- signing-certificate SHA-256;
- signing mode;
- bundled unsigned APK SHA-256;
- source label and staging time.

It never returns the keystore, private key, or signing password.

## Managed Displays behavior

Device Agent v2 status distinguishes:

- the agent version currently reported by the Android device; and
- the verified agent version staged by the Hub.

If they differ, the UI reports an update is available and changes the existing install control to `Update Agent -> <version>`. If they match, it becomes an explicit reinstall of that verified version.

The install action calls the verified artifact route rather than blindly installing an unversioned historical file.

## Permission model

The staged APK and metadata remain mode `0660` and are accessible through shared GID `10001`. The maintenance container explicitly joins that supplemental group because it intentionally drops `CAP_DAC_OVERRIDE`.

Do not solve staging failures by making APKs world-readable or by making the maintenance container privileged.

## Deployment validation

After an appliance update that changes Android agent source:

1. confirm the maintenance image build completes its Android release build stage;
2. confirm maintenance starts healthy, which requires the signed staged APK and metadata to exist and be readable;
3. query the staged artifact endpoint and verify the expected version;
4. confirm Managed Displays reports installed and staged versions separately;
5. install/update the agent;
6. confirm Agent Status reports the staged version;
7. on the first legacy-signature transition only, validate the confirmation and automatic reprovisioning flow;
8. verify `WRITE_SECURE_SETTINGS` and Persistent ADB remain effective after that replacement;
9. repeat a later agent update and confirm it upgrades in place without another signature transition.

## Recovery

If `/etc/classroom-control-hub/android-agent-signing` is lost, maintenance creates a new signing identity. Existing devices will then require the explicit signature-transition replacement workflow again.

Restoring only `data/android-tv/RoomGoblin-Display-Agent.apk` is not sufficient for long-term update continuity. Preserve the signing directory together with appliance configuration and backups.
