# Display Access

Classroom TVs and browser receivers connect directly with their configured display ID.

For the BLC classroom:

```text
http://172.16.127.5:3000/display/tv1
http://172.16.127.5:3000/display/tv2
```

No enrollment token or one-use link is required.

## Setup

Create/enable the display in Classroom Control Hub, assign a stable ID, and configure the TV/mini-PC browser to launch `/display/<id>` automatically. The controller Settings page lists the direct URLs for every enabled display and provides copy/open actions.

Unknown or disabled display IDs are rejected. Enabled display IDs are allowed to connect from the trusted classroom/admin network.

## Security

This is a trusted-network design. Do not expose the Hub's HTTP display endpoint directly to an untrusted/public network. Use network segmentation or an access layer if remote/untrusted access is required.

Windows lab-agent enrollment is separate and remains credentialed.
