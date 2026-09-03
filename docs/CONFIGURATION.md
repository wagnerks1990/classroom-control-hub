# Configuration

## Configuration strategy

Classroom Control Hub separates reusable application code from site-specific runtime configuration. Public source should remain deployable without embedding a real district name, classroom topology, internal address, credential, or stream endpoint.

Configuration comes from:

1. environment variables / `.env`;
2. persistent application configuration stored in SQLite;
3. optional JSON configuration/catalog files for defaults and schemas;
4. protected secret material supplied at runtime.

## `.env`

Start from `.env.example`:

```bash
cp .env.example .env
```

Never commit the resulting `.env`.

Typical categories include:

- application port and timezone;
- persistent data locations;
- Music Assistant connection information;
- MQTT connection information;
- Pluto connection information;
- announcement/stream defaults;
- host/maintenance-agent connection settings;
- authentication/security options.

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

- organization name and branding;
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

## Integration health

Each integration must report its own health independently.

Examples:

- MQTT/Govee status must come from MQTT/Govee runtime state, not from whether Pluto is reachable.
- A missing or unreachable Pluto endpoint should affect Pluto status only.
- Slow optional hardware probes should not delay rendering the controller Overview screen.
- `configured`, `connected/reachable`, and `lastError` are separate concepts and should be represented separately when possible.

## Pluto

Pluto configuration is normally supplied through:

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

## Class schedules

Class schedules can represent normal periods, transition pseudo-periods, and site-specific continuation/Bison periods. The matching engine may consider:

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
