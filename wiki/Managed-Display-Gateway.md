# Managed Display Gateway

Classroom Control Hub can route approved managed-display web content through the Hub so TVs do not need local DNS or hosts-file changes.

## Carlisle Morning Announcements

Default mapping:

```text
stream.carlisleschools.org -> 100.88.92.111
```

Displays receive a same-origin URL under `/display-gateway/`. The Hub then contacts the upstream server while preserving the original HTTP Host and TLS SNI hostname.

Example:

```text
https://stream.carlisleschools.org/LiveApp/play.html?id=morning
```

is presented to a managed display as:

```text
http://HUB:3000/display-gateway/https/stream.carlisleschools.org/LiveApp/play.html?id=morning
```

## Configuration

```dotenv
DISPLAY_GATEWAY_OVERRIDES=stream.carlisleschools.org=100.88.92.111
DISPLAY_GATEWAY_ALLOWED_HOSTS=
```

Override hosts are automatically allowlisted. Additional approved hostnames may be added with `DISPLAY_GATEWAY_ALLOWED_HOSTS`.

## Supported traffic

- ordinary HTTP/HTTPS page requests
- images, CSS, JavaScript and other web assets
- redirects
- HLS playlists and segments
- server-side Morning Announcements HLS probes

Generic proxied WebSocket tunneling is not enabled in this phase. Morning Announcements should use the integrated HLS player for the reliable managed-display path.

## Security

The gateway is not an open forward proxy. Only configured/allowlisted hosts are accepted, credentials embedded in target URLs are rejected, and HTTP `CONNECT` is disabled.

See `docs/MANAGED-DISPLAY-GATEWAY.md` for detailed architecture and validation steps.
