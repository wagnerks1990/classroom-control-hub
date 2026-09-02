# Configuration

Classroom Control Hub is designed so public source code stays generic while each installation supplies its own site-specific settings at runtime.

## Configuration layers

A deployment can use several configuration sources:

- `.env` for environment variables and secrets references
- persistent database/runtime settings configured through the controller
- `config/` JSON files for generic/default device and integration catalogs
- mounted persistent directories for site-specific state

## Never commit production secrets

Do not commit:

- passwords
- API tokens
- MQTT credentials
- Music Assistant tokens
- Ant Media credentials
- SSH keys
- TLS private keys
- student/user data
- production SQLite databases
- backups containing runtime data

Use `.env`, Docker secrets, or another secrets manager.

## Common environment categories

### Application

```env
CLASSROOM_HUB_TIMEZONE=America/New_York
CLASSROOM_HUB_PORT=3000
```

### Music Assistant

```env
MUSIC_ASSISTANT_URL=
MUSIC_ASSISTANT_TOKEN=
```

### MQTT / device integrations

```env
MQTT_HOST=
MQTT_USERNAME=
MQTT_PASSWORD=
```

### Morning Announcements

```env
MORNING_ANNOUNCEMENT_URL=
```

Production stream URLs should remain outside the public source repository.

## Persistent configuration

The controller persists operational settings such as:

- displays and targets
- class schedules
- automations
- cycle-day and school-calendar rules
- Morning Announcements Live Watch settings
- announcement volume
- Background Music schedule and player selection
- integration settings

These values should live in persistent storage mounted into the container.

## Calendar and schedule rules

The scheduling engine supports normal weekdays, cycle days, no-school dates, remote days, half days, delayed starts, transition periods, and class-specific continuation rules.

The expected precedence for school-day exceptions is:

```text
No-School
  > Remote Day
  > Half Day
  > 2-Hour Delay
  > 1-Hour Delay
  > Normal Schedule
```

Deployment-specific dates and class mappings should be configured through runtime state rather than hard-coded into the public repository.

## Display configuration

Displays use stable IDs. A display should reconnect and recover current server state after browser, network, or service restarts.

When changing display-related code, ensure backend and renderer versions remain synchronized.

## Morning Announcements

Morning Announcements have their own settings for:

- enabled state
- stream URL
- watch start/end window
- target displays
- default volume
- stream detection/retry behavior

Manual playback and automatic Live Watch use the same priority state and volume configuration.

## Background Music

Background Music remains independent of normal visual automations. Configuration includes:

- Music Assistant player/group
- source/favorite
- start and end times
- weekdays/school-day rules
- start volume
- pause/resume behavior for priority audio

## Configuration validation

Before production deployment, verify:

1. no secret values are present in tracked files;
2. all required persistent directories are mounted;
3. timezone is correct;
4. display IDs and targets are correct;
5. class/calendar rules resolve the expected current day;
6. integration endpoints are reachable from the appropriate container or host service.
