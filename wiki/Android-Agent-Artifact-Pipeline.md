# Android Agent Artifact Pipeline

Classroom Hub now builds and stages the Android/Google TV Display Agent from the same source checkout as the appliance instead of trusting an old manually copied APK.

## What happens during an update

A one-shot Compose service named `android-agent-builder` runs before the maintenance service. It compares the current `agents/android-tv/` source digest with the staged artifact metadata. When the source changed, it builds, signs, verifies and stages a new APK.

Staged files:

- `/opt/classroom-hub/data/android-tv/ClassroomHub-Display-Agent.apk`
- `/opt/classroom-hub/data/android-tv/ClassroomHub-Display-Agent.json`

Managed Displays shows both the installed Agent version and the staged version. If they differ, the device is marked as having an Agent update available.

## Signing

Each appliance keeps a persistent Android signing identity under:

`/etc/classroom-control-hub/android-agent-signing`

Do not delete this directory on a deployed appliance. Android requires future updates to use the same signing identity.

The signing key is not stored in the Git repository and is not mounted into the main Classroom Hub application container.

## First upgrade from older agents

An older device may have a Display Agent signed by a temporary debug/CI key. Android will reject a normal in-place update from that key to the new appliance-managed signing identity.

When Classroom Hub detects that exact signature mismatch, Managed Displays asks for confirmation before replacing `org.classroomhub.display`. After replacement it restores the saved display URL and Agent v2 configuration automatically.

This should be a one-time transition. Later APKs built by the same appliance use the persistent signing identity and should upgrade normally.

## If installation fails

Check the staged artifact status first. The artifact must be readable, SHA-256 verified, and report the expected version. Do not fix permissions by making the APK world-readable.

The validated Onn Android 14 diagnostic rule still applies: do not use `dumpsys package`. Use direct `pm`, `pidof`, Agent Status/Capabilities and bounded commands instead.

## Disaster recovery

Back up the signing directory along with appliance configuration if Android Agent update continuity matters. Losing the signing directory does not brick the devices, but the replacement/signature-transition workflow will be required again.
