# Configuration

Classroom Control Hub keeps public source generic while each installation supplies site-specific settings at runtime.

## Configuration layers

A deployment can use:

- `.env` for environment variables and secret references
- persistent database/runtime settings configured through the controller
- `config/` JSON files for generic/default device and integration catalogs
- mounted persistent directories for site-specific state

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

## Common environment settings

### Application

```env
ROOM_NAME=Classroom
TZ=America/New_York
SCHEDULER_TIMEZONE=America/New_York
HUB_PORT=3000
```

### MQTT / Govee

```env
MQTT_URL=mqtt://host.docker.internal:1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

### Pluto Mark I

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

## Configuration validation

Before production deployment, verify:

1. no secrets are present in tracked files;
2. persistent directories and secret files are mounted;
3. timezone is correct;
4. display IDs and targets are correct;
5. class/calendar rules resolve the expected current day;
6. integration endpoints are reachable from the correct host/container;
7. Host Agent service and maintenance container both see `/run/classroom-control-hub/host-agent.sock`.
