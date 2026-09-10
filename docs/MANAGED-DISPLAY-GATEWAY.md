# Managed Display Gateway

The Managed Display Gateway lets classroom receivers fetch explicitly approved HTTP(S) media through the Hub when a TV cannot use the required DNS route directly. It is a narrow signage/media relay, not a general forward proxy.

## Configuration

Public defaults are empty. Put site mappings only in the deployment's protected `.env`:

```dotenv
DISPLAY_GATEWAY_OVERRIDES=media.example.edu=192.0.2.10
DISPLAY_GATEWAY_ALLOWED_HOSTS=signage.example.edu
```

Override entries are comma-separated `hostname=IPv4` pairs. Their hostnames are automatically allowlisted. Additional comma-separated allowlist hosts use normal DNS. Restart the Hub after changes; the allowed host list is sent to authenticated display clients during the WebSocket handshake, so the browser and backend use the same policy.

Gateway URLs have this form:

```text
http://hub.example:3000/display-gateway/https/media.example.edu/path/playlist.m3u8
```

The upstream hostname remains the HTTP `Host` and TLS SNI/certificate name even when the Node process uses a forced IPv4 address.

## Security contract

- Only configured hostnames, HTTP/HTTPS, ports 80/443, and GET/HEAD are accepted.
- Client cookies, authorization, setup/control/maintenance tokens, forwarding identity, and hop-by-hop headers are never sent upstream.
- Upstream `Set-Cookie`, `Clear-Site-Data`, CSP, and hop-by-hop response headers are not copied to the Hub origin.
- Gateway responses receive a CSP sandbox. Receiver gateway iframes also omit `allow-same-origin`, preventing proxied scripts from receiving Hub-origin authority.
- Rewritable text is limited to 8 MiB. Request timeout is 15 seconds.
- `CONNECT`, arbitrary ports, embedded URL credentials, and unlisted hosts are rejected.

The route remains reachable on the classroom network because display media subrequests do not carry WebSocket credentials. Its authority is therefore bounded by the fixed allowlist, safe methods/ports, header isolation, response sandbox, and normal network segmentation.

## Rewriting and limitations

The gateway rewrites common root-relative HTML/CSS resource URLs, redirect locations, absolute upstream origins, and HLS playlist entries back through the same gateway. The integrated local Ant Media/HLS player remains the preferred announcement path.

Generic WebSocket tunneling and arbitrary WebRTC proxying are not supported. Do not claim physical-TV playback until it has been validated on the actual device/firmware.

## Verification

1. Configure the site mapping and restart the Hub.
2. Confirm an authenticated display handshake receives the configured hostname.
3. Confirm the receiver requests `/display-gateway/...` and receives `X-Classroom-Hub-Display-Gateway: 1`.
4. Verify non-GET requests, unlisted hosts, and nonstandard ports return 403/405.
5. Verify no Hub cookie/token reaches the upstream and upstream cookies are not installed.
6. Test HLS manifests, segments, redirects, and physical-TV playback.
