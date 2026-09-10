# Managed Display Gateway

## Purpose

The Managed Display Gateway lets Classroom Control Hub displays access approved external web resources through the Hub instead of resolving those sites directly from the TV/browser.

The first production use case is Morning Announcements at `stream.carlisleschools.org`, which must resolve to `100.88.92.111` from the Classroom Hub environment.

## Traffic flow

```text
Managed display
  -> Classroom Hub /display-gateway/...
  -> upstream hostname preserved for HTTP Host and TLS SNI
  -> process-local DNS override resolves stream.carlisleschools.org to 100.88.92.111
  -> Ant Media / web resource
```

The browser therefore does not require a hosts-file entry. The upstream TLS certificate continues to be validated for the original hostname rather than the forced IPv4 address.

## Default mapping

The compatibility default is:

```text
stream.carlisleschools.org=100.88.92.111
```

It can be overridden with:

```dotenv
DISPLAY_GATEWAY_OVERRIDES=stream.carlisleschools.org=100.88.92.111
```

Multiple entries are comma separated.

Hosts present in `DISPLAY_GATEWAY_OVERRIDES` are automatically allowed through the gateway. Additional approved hostnames can be added with:

```dotenv
DISPLAY_GATEWAY_ALLOWED_HOSTS=media.example.edu,signage.example.edu
```

## Display behavior

`public/display/security.mjs` rewrites approved `stream.carlisleschools.org` HTTP(S) media URLs to the same-origin gateway path before the display renderer creates an image, video, or web frame.

Example:

```text
https://stream.carlisleschools.org/LiveApp/play.html?id=morning
```

becomes:

```text
http://HUB:3000/display-gateway/https/stream.carlisleschools.org/LiveApp/play.html?id=morning
```

This keeps the browser connected to Classroom Control Hub while the Hub owns the upstream connection.

## Morning Announcements

The Hub process installs the same DNS override before `server.js` starts. Existing server-side HLS live probes therefore resolve the Ant Media hostname to the configured forced address without requiring `/etc/hosts` on the controller.

The integrated Ant Media HLS player receives the gateway URL and derives its `.m3u8` candidates from that same gateway path, keeping HLS manifests and media segments on the Hub path.

## Full-site resources

The gateway forwards HTTP methods and response bodies for the approved hostname. It preserves relative URLs naturally and rewrites common root-relative HTML/CSS resource references and HLS playlist entries back through the gateway. Redirect `Location` headers are also rewritten.

This is intended for managed-display content, not as a general-purpose forward proxy.

## Security boundaries

- Only HTTP and HTTPS targets are accepted.
- Embedded URL credentials are rejected.
- Only allowlisted hostnames may be proxied.
- `CONNECT` is not supported.
- Hop-by-hop proxy headers are stripped.
- Upstream Host and TLS SNI remain the configured hostname.
- Text responses larger than 8 MiB are not rewritten.
- Arbitrary private-network destinations are not accepted unless an administrator explicitly adds their hostname to the allowlist/override configuration.

## Current limitation

This phase covers HTTP(S), HLS manifests/segments, redirects, and ordinary web assets. It does not yet provide a generic WebSocket tunnel for arbitrary proxied websites. Morning Announcements should continue to use the integrated HLS player as the reliable transport. A future WebSocket gateway can be added with explicit per-host upgrade routing instead of opening an unrestricted tunnel.

## Verification

After deployment, remove the controller `/etc/hosts` entry for `stream.carlisleschools.org`, restart Classroom Hub, and verify:

1. `Check Stream Now` still reaches the stream through the process-local override.
2. A managed display loads the Morning Announcements URL.
3. Browser network requests use `/display-gateway/https/stream.carlisleschools.org/...`.
4. Response headers include `X-Classroom-Hub-Display-Gateway: 1`.
5. HLS playback remains functional while the TV itself has no DNS/hosts override for the stream hostname.
