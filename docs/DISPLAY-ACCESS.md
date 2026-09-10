# Classroom Display Access

Each classroom TV/browser has a stable display ID and an individual, revocable credential. A display ID identifies the receiver; it is not authentication by itself.

## Enrollment

1. Create or enable the receiver under **Settings → Displays**.
2. Open **Settings → Classroom Display Enrollment**.
3. Select **Create Link** for that receiver.
4. Open the one-use URL on the assigned TV/browser before it expires.
5. Confirm the receiver reports Online, then disable the legacy shared-token fallback after every enabled receiver is enrolled.

The URL has this form:

```text
http://hub.example:3000/display/tv1#enrollmentToken=<one-use-token>
```

The fragment is not sent in the initial HTTP request. The receiver exchanges it over its WebSocket, receives a random credential, stores that credential locally under the display ID, and removes the fragment. The server stores only SHA-256 hashes.

## Rotation and revocation

- **Revoke** invalidates one browser credential and disconnects that receiver.
- **Rotate All** revokes every credential for the display and creates a replacement enrollment URL.
- **Cancel Link** invalidates a pending, unused enrollment URL.
- Display renames and ordinary configuration edits preserve credentials; removing a display removes its credentials.

`DISPLAY_TOKEN` exists only as an explicit migration fallback. It works only when a non-empty token is configured and the administrator policy allows it. Do not use it for new deployments.

## Provisioning and recovery

Use kiosk/full-screen mode and configure the browser or Android TV Display Agent to reopen the stable `/display/<id>` path at boot. The credential remains in browser storage. If browser storage is cleared, the receiver must be enrolled again. Managed Android TVs can be sent the enrollment URL through the existing authenticated ADB management channel.

Controller previews use `/display/<id>?preview=1` and require an authenticated controller session; they are not physical display receivers.

Keep the HTTP-only alpha deployment on a trusted classroom/admin network. Individual receiver credentials do not replace VLAN, firewall, and management-network controls.
