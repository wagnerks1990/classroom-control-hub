# Configuration

Classroom Control Hub keeps public source generic while each installation supplies site-specific settings at runtime.

## Configuration layers

A deployment can use:

- persistent database/runtime settings configured through the controller
- the encrypted database secret store for credentials and private keys
- `.env` for bootstrap, host/container boundary, and migration fallback values
- `config/` JSON files for generic defaults, schemas, and migration compatibility
- mounted persistent directories for site-specific state

Normal classroom configuration should be completed in the GUI. MQTT/Govee, Pluto, Veyon, Music Assistant, and update settings become database-authoritative after they are saved. `.env` remains necessary for the database/master-key paths, first-use and internal service credentials, port mapping, and reverse-proxy security boundaries.

## Standard production paths

```env
HOST_CLASSROOM_HUB_DIR=/opt/classroom-hub
HOST_SERVICES_DIR=/opt/services
DATABASE_FILE=/app/data/classroom-control-hub.db
CLASSROOM_HUB_MASTER_KEY_FILE=/etc/classroom-control-hub/master.key
MASTER_KEY_FILE=/run/secrets/classroom-control-hub-master-key
```

Native Host Agent socket:

```text
/run/classroom-control-hub/host-agent.sock
```

Older migration-era references to `/opt/classroom-control-hub`, `/run/classroom-hub/host-agent.sock`, or `HOST_Classroom_DIR` are legacy rather than preferred new configuration.

## Never commit production secrets

Do not commit passwords, API tokens, MQTT credentials, Music Assistant tokens, Ant Media credentials, SSH/TLS private keys, student/user data, production SQLite databases, `.env`, or backups containing runtime state.

Use `.env`, mounted secrets, or the encrypted application secret store.

## Common bootstrap and migration fallback settings

### Application

```env
ROOM_NAME=Classroom
TZ=America/New_York
SCHEDULER_TIMEZONE=America/New_York
HUB_PORT=3000
```

### MQTT / Govee

Configure this under **Settings → Integrations & Hardware**. The GUI stores the password in the encrypted secret store and never returns it to the browser. These environment variables remain supported as first-start fallbacks:

```env
MQTT_URL=mqtt://host.docker.internal:1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

### Pluto Mark I

Configure the endpoint, timeout, and read retries under **Settings → Integrations & Hardware**. Changes are validated, stored in SQLite, and applied live. These environment variables remain supported as first-start fallbacks:

```env
PLUTO_URL=
PLUTO_TIMEOUT_MS=4000
PLUTO_READ_RETRIES=4
```

The public default intentionally leaves `PLUTO_URL` empty. Production supplies the local endpoint through runtime configuration. An unconfigured Pluto should be shown as `NOT CONFIGURED`, not continuously probed with an empty URL.

### Music Assistant

```env
MUSIC_ASSISTANT_URL=http://host.docker.internal:8095
```

### Veyon

Configure the WebAPI endpoint, authentication key name, discovery subnet/range, pool limits, and encrypted private key under **Settings → Integrations & Hardware**. These environment variables remain supported as first-start fallbacks:

```env
VEYON_WEBAPI_URL=http://host.docker.internal:11080
VEYON_KEY_NAME=ClassroomControlHub
VEYON_SCAN_SUBNET=
```

### Morning Announcements

```env
MORNING_ANNOUNCEMENTS_URL=
```

Production stream URLs and stream IDs remain outside the public repository.

## Independent integration health

Each integration reports its own state. A Pluto failure must not make MQTT/Govee appear offline. Slow optional integration checks must not block initial Overview rendering.

Where practical, distinguish:

- configured
- connected/reachable
- current state
- last success
- last error

## Persistent configuration

The controller persists operational settings such as displays, class schedules, automations, cycle/school calendar rules, Morning Announcements settings, announcement volume, Background Music settings, and integration/runtime settings.

These values live in persistent storage mounted into the container.

## School and classroom identity and theming

The setup wizard and controller Settings page store school/district name,
classroom name, product name, logo, favicon, and theme mode/colors in the SQLite
site profile. Normal branding does not require editing `.env` or JSON.

All browser surfaces load the secret-free `/api/v1/branding` contract. The
product is intentionally education-specific and does not expose a neutral
organization/site/space preset.

## Calendar and schedule rules

Expected precedence:

```text
No-School
  > Remote Day
  > Half Day
  > 2-Hour Delay
  > 1-Hour Delay
  > Normal Schedule
```

Deployment-specific dates and class mappings belong in runtime state rather than public source constants.

## Display configuration

Displays use stable IDs and should recover current server state after browser, network, or service restarts. Backend/controller/display versions must remain synchronized during releases.

## Morning Announcements

Morning Announcements configuration includes enabled state, stream/player URL, Live Watch window, target displays, saved volume, and live-detection diagnostics.

For Ant Media player URLs, HLS is the preferred live-state/playback transport when available. Manual and automatic playback share the same highest-priority state.

## Background Music

Background Music remains independent of normal visual automation. It yields to priority audio and resumes only after priority release/reconciliation completes.

## Recovery controls

The main application is the only SQLite owner. The maintenance agent reaches
database status, audit retention, and managed-integration settings through its
token-bound internal API.

- `MANAGED_APP_CONTAINER` defaults to `classroom-control-hub`.
- `RESTORE_HEALTH_TIMEOUT_MS` defaults to `60000`.
- `RESTORE_MAX_EXPANDED_MB` defaults to `4096`.

Every restore creates a pre-restore operational backup, validates archive paths
and expanded size, verifies the SQLite snapshot with `PRAGMA quick_check`, and
waits for application health after restart. Failed verification automatically
restores the safety backup and reports the rollback outcome.

## Configuration validation

Before production deployment, verify:

1. no secrets are present in tracked files;
2. persistent directories and secret files are mounted;
3. timezone is correct;
4. display IDs and targets are correct;
5. class/calendar rules resolve the expected current day;
6. integration endpoints are reachable from the correct host/container;
7. Host Agent service and maintenance container both see `/run/classroom-control-hub/host-agent.sock`.
