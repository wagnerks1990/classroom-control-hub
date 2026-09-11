# Onn Android 14 ADB diagnostics

This note applies to the validated Onn 4K Streaming Device running Android 14 (`wayne`) used with RoomGoblin.

## Do not use `dumpsys package` for routine checks

On this firmware, commands such as:

```bash
adb -s <serial> shell dumpsys package org.roomgoblin.display
```

have repeatedly blocked or hung indefinitely. They must not be used for normal package presence, version, agent-running, or health checks, and they must not be placed on a primary Managed Displays status path.

## Preferred commands

Use direct, bounded commands instead:

```bash
# Installed package / APK path
adb -s <serial> shell pm path org.roomgoblin.display

# Running process
adb -s <serial> shell pidof org.roomgoblin.display

# Device identity / Android properties
adb -s <serial> shell getprop ro.product.model
adb -s <serial> shell getprop ro.build.version.release
adb -s <serial> shell getprop ro.build.version.sdk

# Device Owner / Profile Owner state
adb -s <serial> shell dpm list-owners

# Device Admin receiver declaration
adb -s <serial> shell cmd package query-receivers \
  -a android.app.action.DEVICE_ADMIN_ENABLED \
  org.roomgoblin.display

# Agent v2 listener
adb -s <serial> shell ss -lnt | grep 8765
```

Agent v2 health/status should preferentially use its authenticated HTTP API rather than ADB package inspection after enrollment.

## If `dumpsys` is unavoidable

Use a short timeout and narrowly filter the result. Never allow an unbounded `dumpsys` call to block a status page, recovery loop, installer, or automation.

Example:

```bash
timeout 5 adb -s <serial> shell dumpsys device_policy | head -100
```

Even bounded `dumpsys` should be treated as a fallback diagnostic, not the normal path.

## Maintainer invariant

Future AI-generated troubleshooting instructions and code changes must not reintroduce `dumpsys package` as the standard package/agent probe for the validated Onn Android 14 target. Prefer `pm path`, `pidof`, targeted `getprop`, `cmd package`, and Agent v2 HTTP health checks.
