# Onn Android 14 kiosk cleanup policy

This document records the physically observed package inventory for the validated Onn 4K Streaming Device (`wayne`, Android 14 / SDK 34) and the RoomGoblin kiosk cleanup policy derived from that inventory.

## Diagnostic rule

Do **not** use `dumpsys package` on this validated Onn firmware for routine package/version checks. It has repeatedly hung during physical testing. Prefer bounded package-manager commands such as `pm list packages`, `pm path <package>`, `pidof <package>`, `cmd package ...`, and targeted `getprop` queries.

## Kiosk Minimal Mode

Minimal Mode is intentionally aggressive for dedicated RoomGoblin signage endpoints. It performs `pm uninstall --user 0` rather than merely disabling targeted packages.

It removes every third-party package visible to user 0 except `org.roomgoblin.display`, then attempts to remove the following curated nonessential TV/media packages for user 0 when present:

- `com.google.android.youtube.tv`
- `com.google.android.youtube.tvunplugged`
- `com.google.android.youtube.tvmusic`
- `com.netflix.ninja`
- `com.netflix.tokenmanager`
- `com.google.android.play.games`
- `com.google.android.apps.tv.dreamx`
- `com.android.dreams.basic`
- `com.google.android.feedback`
- `com.android.tv.feedbackconsent`
- `com.google.android.syncadapters.calendar`
- `com.android.providers.calendar`
- `com.android.providers.contacts`
- `com.android.wallpaperbackup`
- `com.android.htmlviewer`

The command reports `REMOVED`, `FAILED`, and `SKIP_NOT_INSTALLED` for every target rather than hiding failures.

## Explicitly preserved classes

Do not automatically remove the Android framework, System UI, Settings, package installer/permission controller, networking/Wi-Fi stack, Bluetooth/remote services, WebView, ADB/shell, launcher fallback, Google Services Framework / Play Services, managed provisioning, device-policy dependencies, input devices, download/media providers, or OEM hardware/settings overlays. These components may be required for boot, networking, RoomGoblin rendering, remote control, recovery, updates, provisioning, or future device-owner management.

## Restoration behavior

`pm uninstall --user 0` for a preinstalled/system package normally removes it only from user 0 and may be reversible with `cmd package install-existing --user 0 <package>`. A true data-installed third-party application may require reinstalling its APK/store package because its package files can be removed entirely.

Minimal Mode therefore requires an explicit destructive confirmation. Use the package audit before changing the curated system-package list for a new hardware/firmware family.
