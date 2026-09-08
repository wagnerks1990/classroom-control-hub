# Classroom Display Access

Classroom Control Hub classroom displays use stable, direct display URLs on the trusted classroom/admin network.

## Canonical URLs

Each enabled display is identified by its configured display ID:

```text
http://<hub-host>:3000/display/<display-id>
```

Examples for the current BLC classroom:

```text
http://172.16.127.5:3000/display/tv1
http://172.16.127.5:3000/display/tv2
```

No display enrollment token, one-use enrollment link, browser credential, or shared `DISPLAY_TOKEN` is required for a configured enabled display.

## Identity and authorization model

The display ID is the receiver identity. A WebSocket connection is accepted as a physical classroom display only when the supplied ID exists in the `display_devices` database table and is enabled. Unknown or disabled IDs are rejected.

This intentionally differs from controller/user authentication and Windows lab-agent enrollment. Administrator/controller access remains authenticated. Windows lab agents remain individually enrolled and credentialed.

## Provisioning a TV or mini PC

1. Create or enable the display in Classroom Control Hub configuration.
2. Give it a stable ID such as `tv1`, `tv2`, or `hallway1`.
3. Configure the receiver browser to open `/display/<id>` at startup.
4. Use kiosk/full-screen browser mode where appropriate.
5. Verify the display reports Online in the controller.

No browser-side secret provisioning is required.

## Security boundary

Direct display URLs are intentionally designed for a trusted classroom/admin network. The Hub's HTTP service must not be exposed directly to an untrusted or public network without an appropriate network/security layer. A client that can reach the Hub and knows an enabled display ID can connect as that display.

Use network segmentation, firewall policy, VLANs, or a trusted reverse-proxy/access layer if the Hub is reachable beyond the classroom management network.

## Legacy enrollment data

Database tables and historical records for display enrollment/credentials may remain for schema compatibility and rollback history, but they are not authoritative for normal classroom display access. New features must not reintroduce enrollment as a requirement unless the product architecture is intentionally changed again.

## Preview mode

Controller previews continue to use `/display/<id>?preview=1`. Preview clients are not treated as physical display receivers.
