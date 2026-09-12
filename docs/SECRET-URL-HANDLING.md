# Secret-bearing URL handling

Some upstream media systems encode bearer credentials in URL query parameters.
RoomGoblin treats those URLs as secrets even when the upstream vendor calls them
playback URLs.

The Morning Announcements stream URL is stored in the encrypted SQLite secret
store. Existing `morning-announcements.json` data is migrated at startup and the
legacy source file is atomically rewritten without the URL. Browser-facing
configuration returns only the `••••••••` sentinel and a
`streamUrlConfigured` boolean. Sending the sentinel back while changing another
setting preserves the stored URL.

Only authenticated physical display receivers receive the resolved announcement
playback URL. REST status responses, controller and preview WebSockets, command
responses, audit events, and diagnostics use redacted projections. Persistent
display state stores a protected-URL marker for an active announcement; a
reconnecting physical receiver has that marker hydrated from encrypted storage.

Audit ingestion removes fields whose names indicate passwords, tokens, secrets,
credentials, or private key material. It also removes URL user information and
all query values before an event enters memory or SQLite. Read endpoints sanitize
again so records imported from earlier releases cannot expose these values.

Operational logs must print `endpointForLog(...)` rather than raw service URLs.
The endpoint-only form removes URL user information, query parameters, and
fragments. Add a sentinel-secret regression whenever a new integration accepts a
URL that can contain authorization material.
