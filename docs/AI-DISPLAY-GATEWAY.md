# AI Context — Managed Display Gateway

The gateway is installed by the `src/direct-display-compat.js` preload before Express is created. Despite the historical filename, this preload must not replace `ClassroomHubStorage.authenticateDisplay` or enable credentialless display access.

Authoritative implementation:

- Backend: `src/display-gateway.js`
- Browser policy: `public/display/security.mjs`
- Handshake configuration: `DISPLAY_GATEWAY_HOSTS` in `src/server.js`
- Route: `/display-gateway/{http|https}/{encoded-host}/...`

Public defaults are intentionally empty. Never add a production hostname or IP to source, tests, or `.env.example`.

Non-negotiable rules: configured hosts only; ports 80/443; GET/HEAD only; no request credentials/tokens/forwarding headers; no response cookies; CSP-sandbox proxied active content; no `allow-same-origin` on gateway frames; bounded response/time; no CONNECT or generic WebSocket tunnel. Browser and backend allowlists must come from the same runtime configuration.

Repository tests prove policy mechanics. Actual announcement/HLS playback on a physical TV remains a deployment acceptance test and must not be claimed from unit tests alone.
