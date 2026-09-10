# Managed Display Gateway

The gateway relays approved media/signage destinations through the Hub. Configure site-specific mappings only in the protected runtime `.env`:

```dotenv
DISPLAY_GATEWAY_OVERRIDES=media.example.edu=192.0.2.10
DISPLAY_GATEWAY_ALLOWED_HOSTS=signage.example.edu
```

Authenticated displays receive this host list at connection time. The gateway accepts only configured hosts, HTTP/HTTPS on ports 80/443, and GET/HEAD. It strips Hub cookies, credentials, tokens, and forwarding identity from upstream requests; it drops upstream cookies and sandboxes active responses so they cannot inherit Hub-origin authority.

It rewrites redirects, common root-relative resources, absolute upstream origins, and HLS playlists. Generic WebSocket/WebRTC tunneling is not supported. Validate manifests, segments, redirects, header isolation, and actual playback on each physical TV model.
