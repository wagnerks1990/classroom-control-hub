# Android Agent Artifact Pipeline

Classroom Hub builds the Android/Google TV Display Agent from the same source revision as the appliance instead of trusting an old manually copied APK.

## What happens during an update

The normal `maintenance-agent` Docker build contains an Android build stage. It compiles the current `agents/android-tv/` source into an unsigned release APK and copies that artifact into the maintenance image together with its version/build metadata.

When the maintenance container starts, it signs that exact bundled APK using this appliance's persistent Android signing identity, verifies it, and stages:

- `/opt/classroom-hub/data/android-tv/ClassroomHub-Display-Agent.apk`
- `/opt/classroom-hub/data/android-tv/ClassroomHub-Display-Agent.json`

The maintenance service does not become healthy with a missing/unreadable staged artifact. Managed Displays shows both the installed Agent version and the verified staged version. A mismatch is shown as an Agent update.

## Signing

Each appliance keeps its persistent Android signing identity under:

`/etc/classroom-control-hub/android-agent-signing`

Do not delete this directory on a deployed appliance. Android requires future in-place APK updates to use the same signing identity.

The signing material is not stored in Git and is not mounted into the main Classroom Hub application container. Only the maintenance service gets the signing mount required to stage the APK.

## First upgrade from older agents

An older device may have a Display Agent signed by a temporary debug/CI key. Android can reject the first update to the appliance-managed signing identity.

When Classroom Hub detects that exact signature mismatch, Managed Displays asks for explicit confirmation before replacing only `org.classroomhub.display`. After replacement it restores the saved display URL, Agent v2 configuration and, when Persistent ADB is enabled, the trusted `WRITE_SECURE_SETTINGS` grant.

This should be a one-time transition. Later APKs staged by the same appliance use the persistent signing identity and should upgrade normally.

## If installation fails

Check the staged artifact status first. It must be readable, SHA-256 verified, and match the Android build embedded in the running maintenance image. Do not fix permissions by making the APK world-readable or by making the maintenance container privileged.

The validated Onn Android 14 rule still applies: do not use `dumpsys package`. Use direct `pm`, `pidof`, Agent Status/Capabilities and bounded commands instead.

## Disaster recovery

Back up the signing directory along with appliance configuration if Android Agent update continuity matters. Losing the signing directory does not brick managed devices, but they will require the explicit signature-transition replacement workflow again after a new identity is generated.
