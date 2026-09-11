# Configuration

## Host-network deployment contract

The Linux Hub and maintenance containers, plus reviewed managed add-on templates, now use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

## Configuration strategy

RoomGoblin separates reusable application code from site-specific runtime configuration. Public source should remain deployable without embedding a real district name, classroom topology, internal address, credential, or stream endpoint.

Configuration comes from:

1. persistent application configuration stored in SQLite and managed through the controller;
2. encrypted credentials stored in the SQLite secret store;
3. environment variables / `.env` required to bootstrap the appliance or provide host/container boundaries;
4. optional JSON configuration/catalog files used only for shipped defaults, schemas, and migration compatibility.

Normal classroom identity, display, schedule, automation, MQTT/Govee, Pluto, Veyon, Music Assistant, and application-update configuration should be changed through the GUI. `.env` remains necessary for settings that must exist before SQLite can be opened or before the browser is available, including database/master-key paths, initial setup and internal service tokens, port mapping, and reverse-proxy security boundaries.

## `.env`

Start from `.env.example`:

```bash
cp .env.example .env
```

Never commit the resulting `.env`.

Before the first network-accessible start, generate unique bootstrap, display,
and maintenance credentials. For example:

```bash
openssl rand -hex 32
```

Store separate generated values in `SETUP_TOKEN`, `DISPLAY_TOKEN`, and
`MAINTENANCE_TOKEN`. The first administrator request must provide
`SETUP_TOKEN` in the `X-Setup-Token` header; the token is never accepted in a
query string. Authentication remains enabled after bootstrap.

The stabilization defaults intentionally disable anonymous classroom
participation. Direct shell execution, source-ZIP updates, browser editing of
`.env`, and arbitrary host-file mutation have been removed. Do not enable
`MAINTENANCE_PROXY_ENABLED` on an untrusted network.

Typical categories include:

- application port and timezone;
- persistent data locations;
- host/maintenance-agent connection settings;
- authentication/security options.

Legacy integration values in `.env` are used as initial fallbacks. Once MQTT/Govee, Pluto, or Veyon connection settings are saved under **Settings → Integrations & Hardware**, the database values become authoritative and are applied live. MQTT passwords and Veyon private keys are stored encrypted and are never returned to the browser.

Access profiles are also stored in SQLite. Assign every user the least-privilege
profile that fits their classroom role. Viewing browser history, screenshots,
Veyon framebuffers, and monitoring alerts requires `lab.sensitive.read` even
when the user can operate ordinary classroom devices.

Student-data retention is configured under **Settings → Student Data
Retention**. Browser history is measured in hours; screenshots, monitoring
alerts, and audit records are measured in days. Saving a policy changes future
cleanup behavior. Selecting **Apply now** also prunes records older than the new
limits immediately.

Cross-origin API access is disabled unless an exact origin is listed in the
comma-separated `CORS_ALLOWED_ORIGINS` setting. Same-origin browser use needs
no CORS entry.

## Standard host-path variables

The standard production checkout is `/opt/classroom-hub`.

Current public defaults include:

```text
HOST_CLASSROOM_HUB_DIR=/opt/classroom-hub
HOST_SERVICES_DIR=/opt/services
DATABASE_FILE=/app/data/classroom-control-hub.db
CLASSROOM_HUB_MASTER_KEY_FILE=/etc/classroom-control-hub/master.key
MASTER_KEY_FILE=/run/secrets/classroom-control-hub-master-key
```

The native Host Agent uses:

```text
/run/classroom-control-hub/host-agent.sock
```

Older migration-era references to `/opt/classroom-control-hub`, `/run/classroom-hub/host-agent.sock`, or `HOST_Classroom_DIR` should be treated as legacy compatibility details rather than preferred new configuration.

## Secrets

Credentials must not be placed in public configuration examples. Use environment variables, Docker secrets, or the encrypted application secret store as appropriate.

Examples of secret values:

- API tokens;
- passwords;
- private keys;
- signing secrets;
- MQTT credentials;
- Music Assistant tokens;
- host-agent authentication credentials.

The encrypted secret store depends on protected master-key material. Losing that key can make encrypted records unrecoverable; exposing it compromises encrypted records.

## Site-specific values

The following should normally be runtime configuration rather than source constants:

- school/district and classroom branding;
- classroom names;
- display IDs/names;
- private/internal IP addresses;
- AV matrix addresses and Pluto URL;
- lighting device IDs;
- Music Assistant player IDs;
- stream/application IDs and URLs;
- class schedules;
- school calendar exceptions;
- delay/half-day mappings;
- classroom automation targets.

## School and classroom identity and theme

Normal branding is configured in **Settings → School & Classroom Branding** or during browser
setup and is stored in SQLite under the site profile. It does not require an
`.env` or tracked JSON edit. The profile includes:

- school/district and classroom names;
- product/portal name, logo URL, and favicon URL;
- dark, light, or system color mode plus validated primary, accent,
  background, surface, and text colors.

The unauthenticated `GET /api/v1/branding` response intentionally contains only
presentation-safe fields so the sign-in and display surfaces can load the
correct identity before a user session exists. It never returns preferences,
credentials, integration configuration, or encrypted-secret metadata. Brand
asset URLs accept HTTP(S) or site-relative paths and reject executable URL
schemes. Each saved profile receives a monotonically increasing revision.

The product is intentionally education-specific. New code should use classroom,
school, teacher/operator, student/participant, class schedule, and display/TV
language where it makes the workflow clearer. Do not add a neutral organization
preset or generic organization/site/space aliases.

## Integration health

Each integration must report its own health independently.

Examples:

- MQTT/Govee status must come from MQTT/Govee runtime state, not from whether Pluto is reachable.
- A missing or unreachable Pluto endpoint should affect Pluto status only.
- Slow optional hardware probes should not delay rendering the controller Overview screen.
- `configured`, `connected/reachable`, and `lastError` are separate concepts and should be represented separately when possible.

## Pluto

Pluto is normally configured under **Settings → Integrations & Hardware**. The following values remain supported as first-start or migration fallbacks:

```text
PLUTO_URL=
PLUTO_TIMEOUT_MS=4000
PLUTO_READ_RETRIES=4
```

The public default leaves `PLUTO_URL` empty. Production must supply the local endpoint in `.env` or other supported runtime configuration.

Do not probe an empty URL. An unconfigured Pluto should be represented as `NOT CONFIGURED` rather than repeatedly producing network/URL errors.

## Displays

Each display should use a stable logical ID. Names may change without changing identity.

Recommended conceptual record:

```json
{
  "id": "tv1",
  "name": "Front Display",
  "enabled": true
}
```

Do not use a transient IP address as the only display identity unless the environment guarantees it is stable.

Enabled receivers use their stable `/display/<id>` URL without credentials by default. This is the supported classroom mode and prevents cleared browser storage or an upgrade from taking every display offline.

Administrators may opt into individual credentials under **Settings → Classroom Display Access**. First create and consume an expiring, one-use link for every enabled receiver, then enable **Require individual display credentials**. The enrollment secret is carried in the URL fragment, so it is not sent in the initial HTTP request or retained in server access logs:

```text
http://hub.example/display/?id=tv1#enrollmentToken=<one-time token>
```

The display consumes the token once, receives its own credential, stores it in
browser local storage under that display ID, and removes the fragment from the
visible URL. Only token hashes are stored in SQLite. Administrators can revoke
one credential, rotate all credentials for a display, or cancel an unused link.

`DISPLAY_TOKEN` is only a legacy fallback when individual credential authentication is required. It is unnecessary in the default stable URL mode. Unknown and disabled display IDs are rejected in both modes.

## Class schedules

Class schedules can represent normal periods, transition pseudo-periods, and explicitly linked continuation periods. The matching engine may consider:

- start/end time;
- weekday;
- cycle day;
- schedule/day type;
- include/exclude dates;
- class period mapping;
- enabled state.

Continuation logic must use class identity/period mapping, not simply time proximity. Adjacent unrelated classes should never be chained just because they are separated by a short transition.

## School calendar rules

Calendar exceptions should be configurable for each deployment. Typical categories are:

- no-school/closure;
- remote day;
- half day;
- one-hour delay;
- two-hour delay.

Precedence must be deterministic if a date is accidentally assigned more than one category. The deployment should document its precedence policy.

A remote day may suppress scheduled physical-classroom actions while still allowing manual administrative controls.

## Morning Announcements

Morning Announcements configuration includes:

- enabled state;
- stream/player URL;
- watch-window start/end;
- target displays;
- saved announcement volume;
- live-detection method/runtime diagnostics.

The manual and automatic announcement paths should enter the same priority state. For Ant Media player URLs, HLS is the preferred live-state and playback transport when available.

## Background Music

Background Music is independent from normal automation scheduling. Configuration typically includes:

- enabled state;
- Music Assistant player/group;
- favorite/source;
- start/end time;
- weekdays/student-school-day filtering;
- initial/saved volume;
- priority-audio pause behavior.

## Recovery controls

The maintenance agent does not open the application SQLite database. Database
status, audit retention, and managed-integration settings use a token-bound
internal API so the main application remains the only database writer.

- `MANAGED_APP_CONTAINER` selects the application container restarted during
  recovery (default `classroom-control-hub`).
- `RESTORE_HEALTH_TIMEOUT_MS` sets the time allowed for the application and
  restored database to become healthy (default `60000`).
- `RESTORE_MAX_EXPANDED_MB` limits the expanded size of an accepted recovery
  archive (default `4096`).
- `RECOVERY_ENVELOPE_MAX_MB` bounds the buffered plaintext payload inside an
  encrypted Full Recovery `.rgbak` (default `256`; hard maximum `512`).
- `HOST_BACKUP_DIR` owns clean-host recovery staging beneath its fixed
  `recovery-staging/` child (default root `/opt/classroom-hub-backups`).

Full Recovery passphrase requests require a direct loopback client or HTTPS
terminated by a same-host loopback reverse proxy. For the proxy case,
`TRUST_PROXY_HOPS` must equal its exact hop count and clients must not reach the
backend listener directly. Leave `TRUST_PROXY_HOPS=0` for direct deployments.
The passphrase is memory-only and is not a configurable or stored application
secret.

Legacy database/data ZIP restores create a `pre-restore` operational backup.
Full Recovery instead uses a complete host-owned safety snapshot and durable
transaction journal covering every affected root. Both workflows validate the
selected archive before mutation, require the SQLite snapshot to pass
`PRAGMA quick_check`, and require application health after restart. A failed
Full Recovery rolls every changed root back rather than mixing the two states.

## Public-repository checklist

Before committing configuration-related changes, search for:

```text
password
token
secret
api_key
private key
172.16.
192.168.
10.
internal hostnames
real stream domains
real student/user information
```

Private RFC1918 addresses are not credentials, but production topology should still be kept out of a reusable public project unless intentionally documented.

## Configuration validation

`config/schema/site.schema.json` is the starting point for machine-readable site validation. As the project matures, new public configuration fields should be added to the schema and documented here at the same time.
