# Managed Android / Google TV Minimal Mode

Managed Minimal Mode is an optional Classroom Control Hub cleanup profile for Android TV / Google TV devices that are being used as dedicated classroom displays.

## Goals

- Keep the Classroom Hub Display Agent installed and runnable.
- Leave Android/Google TV core system packages untouched.
- Avoid uninstalling or deleting firmware packages.
- Disable only third-party packages installed for Android user 0.
- Keep the operation reversible.

## Managed Displays controls

**Audit Apps** lists third-party packages and currently disabled third-party packages on the selected display.

**Minimal Mode** disables third-party packages for user 0 except `org.roomgoblin.display`. It uses `pm disable-user --user 0`, so package files remain installed and can be restored.

**Restore Apps** re-enables disabled third-party packages for user 0.

The current implementation intentionally does not disable Google Play services, Android System WebView, Settings, Package Installer, the Google TV launcher, networking components, ADB components, or other system packages. This conservative boundary is required because vendor firmware differs across Android TV devices.

## Deployment guidance

Use Minimal Mode only when a device is intended to function as a dedicated Classroom Hub endpoint. Schools that still need streaming, conferencing, signage, accessibility, or vendor-specific applications should audit the package list before enabling it.

Do not use arbitrary debloat package lists copied from unrelated Android TV models. A package that is optional on one firmware build can be required on another.

## Reversibility

Minimal Mode does not uninstall packages. To roll back, use **Restore Apps**. A factory reset is not required.

## Validation

After enabling Minimal Mode verify:

- Classroom Hub Display Agent remains installed and Running.
- Assigned display URL still loads.
- Persistent ADB still returns on the configured management port.
- Remote shell/status/screenshot remain functional.
- Reboot recovery remains unattended.
- HDMI-CEC and any required vendor functions still work before declaring a firmware build supported.
