# Display Access

Every classroom receiver uses a stable display ID plus an individual, revocable browser credential. Knowing `/display/<id>` is not sufficient to connect as a physical display.

## Setup

In **Settings → Classroom Display Enrollment**, create a one-use link for the enabled display and open it on the assigned TV/browser:

```text
http://hub.example:3000/display/tv1#enrollmentToken=<one-use-token>
```

The receiver consumes the expiring token once, stores its issued credential locally, and reconnects at the stable `/display/tv1` path. The Hub stores only hashes.

Administrators can cancel pending links, revoke one credential, or rotate all credentials for a display. Renaming a receiver does not invalidate its credential. Removing or disabling a receiver prevents it from connecting.

Keep `DISPLAY_TOKEN` only as a temporary migration fallback, then disable legacy access when enrollment coverage is complete. If a TV loses browser storage, enroll it again.

The HTTP-only alpha deployment must remain on a trusted classroom/admin network with normal VLAN and firewall controls.
