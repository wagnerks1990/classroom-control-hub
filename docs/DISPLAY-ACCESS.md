# Classroom Display Access

Classroom receivers use stable URLs such as `/display/tv1`. By default, any enabled configured display ID may connect without a browser credential. This is intentional for trusted classroom networks and avoids taking displays offline after browser storage is cleared, a device is replaced, or the Hub is upgraded.

Unknown, removed, or disabled display IDs are always rejected. URL-only display access does not authenticate the person or device using an enabled ID, so keep the HTTP deployment restricted to the trusted classroom/admin network with VLAN and firewall controls.

## Default: stable URL access

1. Create or enable the receiver under **Settings → Displays**.
2. Configure the TV, kiosk browser, or Android Display Agent to open `/display/<id>`.
3. No enrollment link, display token, or browser credential is required.

Protected `/media/*` and `/presentations/*` resources still use short-lived signed asset URLs issued after the receiver connects. Disabling display authentication does not make those application paths public.

## Optional credential authentication

Administrators who need per-browser revocation can open **Settings → Classroom Display Access**, enroll every enabled receiver with a one-use link, and then select **Require individual display credentials**. The controller refuses to enable this mode while an enabled display lacks a credential unless the administrator explicitly overrides the safety check through the API.

Enrollment URLs have this form:

```text
http://hub.example:3000/display/tv1#enrollmentToken=<one-use-token>
```

The receiver exchanges the token over its WebSocket, stores the issued credential locally, and removes the URL fragment. The server stores only hashes. Credentials can be revoked or rotated independently.

Turning credential authentication off restores stable URL access immediately. Existing credentials may remain stored for a future opt-in; they are not required while the policy is off.

`DISPLAY_TOKEN` is only a legacy fallback when credential authentication is required. It is not needed in the default stable URL mode.

Controller previews use `/display/<id>?preview=1` and remain protected by the authenticated controller session.
