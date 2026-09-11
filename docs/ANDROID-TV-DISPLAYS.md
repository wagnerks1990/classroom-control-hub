# Android / Google TV Managed Displays

RoomGoblin manages Android TV / Google TV endpoints through wireless ADB plus the RoomGoblin Display Agent. The first physically validated target is the Onn 4K Streaming Device running Android 14 (`wayne`, build `UKRB.260113.075.A1`). The provider remains generic; Onn is a validated target, not a hard-coded dependency.

## Architecture

```text
Administrator browser
  -> RoomGoblin :3000
    -> authenticated maintenance proxy
      -> maintenance-agent 127.0.0.1:3010
        -> wireless ADB
          -> Android / Google TV

Android / Google TV
  -> org.roomgoblin.display
    -> immersive WebView
      -> RoomGoblin /display/<id>
```

The current appliance runtime uses Docker host networking for both RoomGoblin and the maintenance agent. RoomGoblin normally binds `0.0.0.0:3000`; maintenance binds loopback-only `127.0.0.1:3010`. Therefore the internal maintenance URL is `http://127.0.0.1:3010`. Do not regress this feature branch to the older bridge-network `maintenance-agent:3010` topology. The maintenance listener is authenticated with `MAINTENANCE_TOKEN` and must not be exposed directly to the LAN.

ADB keys and managed-device inventory persist under `data/android-tv/`. Recreating containers must not remove enrollment records.

## Lifecycle invariant: enroll once, configure afterward

Enrollment establishes ADB trust, probes the endpoint, and creates a stable managed-device ID. Routine assignment/configuration is separate and must never require re-pairing.

Enrollment fields are limited to device name, host/IP, pairing port/code and current ADB connect port. After enrollment use **Edit** to change school, building, room, profile and display URL. A room move, rename, content change or profile change must not touch the ADB trust relationship.

The tested L127 Onn retained its stable identity through repeated container rebuilds and device reboots.

## Validated capabilities

The physical Onn Android 14 test validated:

- wireless pairing and enrollment;
- manufacturer/model/version/build probe;
- Home, Back, OK and volume controls;
- screenshots and administrator remote shell;
- reboot command;
- APK streamed installation;
- Display Agent package/version/running detection;
- agent configuration and immersive RoomGoblin content display;
- pairing authorization surviving reboot;
- persistent Wireless Debugging restoration after firmware disables it during reboot;
- fixed ADB endpoint recovery at port `5555`;
- automatic Hub reconnect without re-pairing;
- automatic Display Agent startup after reboot;
- automatic assigned content restoration after reboot.

Observed reboot sequence:

```text
reboot
 -> device temporarily unreachable
 -> persistent-ADB boot policy restores wireless debugging
 -> 172.16.x.x:5555 returns
 -> Hub transitions Recovering -> Online
 -> agent starts
 -> assigned RoomGoblin display URL loads
```

The agent can become runnable slightly after ADB itself returns. Managed Displays therefore treats the post-boot interval as recovery/startup rather than immediately declaring a permanent agent failure.

## Display Agent

Agent source is in `agents/android-tv/`; package ID is `org.roomgoblin.display`.

The agent is Leanback-compatible, immersive, keeps the screen awake while active, stores its assigned display URL, suppresses accidental Back exit, accepts package-scoped configuration, and participates in persistent-ADB boot recovery.

Managed Displays reports **Not installed**, **Installed · stopped**, **Starting**, **Running**, or **Unavailable**. Agent status probes use Android-compatible shell quoting. Remote Shell uses the same quoted remote-script path so pipelines and compound shell commands are preserved correctly.

The boot implementation stores the persistent-ADB policy in device-protected storage so it is available at `LOCKED_BOOT_COMPLETED`. Kiosk activity launch remains best-effort because Android/OEM firmware controls when foreground UI may start. The Hub supplies a second recovery layer: as soon as ADB reconnects, it verifies the assigned device and can accelerate agent launch rather than waiting for the normal policy interval.

For test installation place the APK at `data/android-tv/RoomGoblin-Display-Agent.apk` and use **Install Agent**. Production deployments should use a signed release APK.

## Persistent ADB

The tested Onn firmware preserves pairing authorization but disables Wireless Debugging during reboot. RoomGoblin's opt-in persistent-ADB bootstrap grants the agent `WRITE_SECURE_SETTINGS`, records the policy, restores `development_settings_enabled` / `adb_wifi_enabled`, and pins the managed endpoint to port `5555`.

This is powerful administrative access. Use it only on trusted device-management networks and restrict ADB to the RoomGoblin management host/network. See `docs/PERSISTENT-ANDROID-ADB.md` for the security model and recovery details.

A temporary failure during reboot is expected. Managed Displays uses bounded recovery polling rather than immediately demanding a new pairing code. Do not re-pair a device merely because it is rebooting or because its room/content metadata changed.

## Power behavior

Android deep sleep is not a reliable default scheduled power mechanism because the tested Onn can drop its network/ADB management path while sleeping. The standard classroom profile should keep the Android endpoint manageable. Treat these as separate concepts:

- kiosk/display-content schedule;
- physical panel power, preferably HDMI-CEC where validated;
- Android deep sleep, an advanced/manual action with recovery caveats.

HDMI-CEC still requires hardware-specific validation before physical TV-panel on/off is advertised as guaranteed.

## Managed Minimal Mode

Managed Displays includes a conservative, reversible cleanup workflow for dedicated signage endpoints:

- **Audit Apps** inventories third-party packages;
- **Minimal Mode** disables third-party packages for Android user 0 except `org.roomgoblin.display`;
- **Restore Apps** re-enables packages disabled for user 0.

The workflow does not uninstall firmware or remove Android/Google TV core system packages. Always audit a new hardware/firmware family before applying minimal mode. The RoomGoblin agent, WebView, networking, Settings, package management, Google/Android framework components and ADB dependencies must remain intact.

See `docs/MANAGED-ANDROID-MINIMAL-MODE.md` for operational guidance.

## Managed Displays refresh/recovery

The browser performs active status refresh while the page is visible, slows polling when hidden, and uses faster bounded polling during explicit reboot recovery. A reboot card should progress through **Recovering** and agent **Starting** states instead of displaying stale green Online state or premature permanent errors.

The maintenance policy interval is separate from browser status refresh. The UI may update much faster than the normal background policy cycle.

## Deployment and networking checks

Current host-network deployment should show no normal Docker `3000->3000` port mapping. Verify listeners on the host:

```bash
ss -lntp | grep -E ':3000|:3010'
```

Expected intent:

```text
0.0.0.0:3000   RoomGoblin
127.0.0.1:3010 maintenance-agent
```

From the RoomGoblin container, the maintenance API must be reachable at loopback with the maintenance token:

```bash
docker compose exec -T classroom-hub node - <<'NODE'
fetch('http://127.0.0.1:3010/android/status', {
  headers: {'x-maintenance-token': process.env.MAINTENANCE_TOKEN}
}).then(async r => console.log(r.status, await r.text())).catch(console.error)
NODE
```

Direct unauthenticated requests to maintenance should return `401 Unauthorized`; that is expected.

If Managed Displays remains at **Checking ADB…** and no inventory cards render, first verify the maintenance proxy/network path. Do not assume the persisted enrollment was deleted. Check `data/android-tv/devices.json` before re-pairing.

## Scale-out workflow

For each new endpoint:

1. Put the device on the approved management network.
2. Enable Developer Options and Wireless Debugging.
3. Pair/enroll once.
4. Edit site/building/room/profile/content metadata.
5. Install and configure the Display Agent.
6. Bootstrap persistent ADB when approved.
7. Reboot without intervention and validate ADB, agent and content recovery.
8. Record exact model, Android version, build/fingerprint and power/CEC behavior in the support matrix.
9. Optionally audit/apply Managed Minimal Mode after device-family validation.

Large deployments should preserve the same stable-device model; future USB/bulk bootstrap can change enrollment mechanics without changing room/content identity.

## Security

Remote shell is administrator-grade access. Routine controls use fixed ADB argument arrays; arbitrary shell is intentionally available only through the authenticated maintenance path. Never expose ADB or the maintenance listener to the public Internet. Prefer a dedicated AV/device-management VLAN with ACLs.

## Related documentation

- `docs/PERSISTENT-ANDROID-ADB.md`
- `docs/MANAGED-ANDROID-MINIMAL-MODE.md`
- `docs/ANDROID-TV-SUPPORT-MATRIX.md`
- `wiki/Android-TV-Displays.md`
- `docs/AI-CONTEXT.md`
