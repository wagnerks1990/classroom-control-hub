# Configuration

See [Host Networking](Host-Networking) for the current Linux container topology, loopback-only maintenance API, explicit add-on migration, listener ports and recovery rules.

RoomGoblin keeps public source generic while each installation supplies school-specific settings at runtime.

## Configuration layers

A deployment can use:

- persistent database/runtime settings configured through the controller;
- the encrypted database secret store for credentials and private keys;
- `.env` for bootstrap, host/container boundary, and migration fallback values;
- `config/` JSON files for generic defaults, schemas, and migration compatibility;
- mounted persistent directories for site-specific and managed-integration state.

Normal classroom configuration should be completed in the GUI. MQTT/Govee, Pluto, Veyon, Music Assistant, displays, schedules, automations, and update settings become database-authoritative after they are saved.

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

Alpha.71 reconciles the alpha.70 database-name split. `DATABASE_FILE` is authoritative. The installer takes SQLite-safe backups of every `data/*.db`, stops the app before active-database canonicalization, verifies the migrated database with `PRAGMA quick_check`, preserves the prior file for rollback, and updates `.env` before recreation.

## Current transport

The appliance is temporarily HTTP-only:

```env
HUB_BIND_ADDRESS=0.0.0.0
HUB_PORT=3000
TRUST_PROXY_HOPS=0
```

Restrict TCP/3000 to the trusted classroom/admin network. Caddy/TLS is intentionally deferred to a later reviewed release.

Full Recovery has a stricter transport rule. Its passphrase may travel only
through a direct loopback connection or HTTPS terminated by a same-host
loopback reverse proxy. For that proxy, set `TRUST_PROXY_HOPS` to the exact hop
count and prevent clients from reaching the backend listener directly. Leave it
at `0` for direct deployments.

Recovery-related host settings include:

```env
HOST_BACKUP_DIR=/opt/classroom-hub-backups
RESTORE_MAX_EXPANDED_MB=4096
RECOVERY_ENVELOPE_MAX_MB=256
```

`RECOVERY_ENVELOPE_MAX_MB` controls the buffered plaintext payload inside an
encrypted `.rgbak`; it cannot exceed the hard 512 MiB ceiling. Full Recovery
stages only within `${HOST_BACKUP_DIR}/recovery-staging`. The recovery
passphrase is never a `.env` value and must not be persisted by RoomGoblin.

## Never commit production secrets

Do not commit passwords, API tokens, MQTT credentials, Music Assistant tokens, Ant Media credentials, SSH/private keys, student/user data, production SQLite databases, `.env`, or backups containing runtime state.

## Optional managed integrations

Setup and **Infrastructure & Recovery** expose a supported add-on catalog. The controller is the appliance control plane: it discovers Docker containers already on the host, can adopt an existing supported service without recreating it, and can explicitly deploy/recreate/remove supported add-ons while preserving their managed data.

Current first-class add-ons:

| Integration | Container | Managed image |
| --- | --- | --- |
| Mosquitto | `mosquitto` | `eclipse-mosquitto:2.0.22` |
| Govee2MQTT | `govee2mqtt` | `ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72` |
| Music Assistant | `music-assistant-server` | `ghcr.io/music-assistant/server:2.9.13` |

Veyon and Veyon WebAPI are native, host-managed services rather than a managed proxy container.

Supported actions are intentionally distinct:

- **Adopt Existing** — record/control the existing container without recreation.
- **Install / Deploy** — create a missing supported service from its reviewed template.
- **Save & Recreate / Update** — explicitly replace the container using saved settings while preserving managed persistent data.
- **Remove** — remove the supported container while preserving its managed data directory for redeploy/rollback.

Existing Docker containers outside the first-class catalog can still be inventoried and safely operated through authenticated lifecycle/log/inspect controls. New arbitrary images are not accepted by the Host Agent; new `docker run` operations remain restricted to reviewed integration images.

### Mosquitto

Managed Mosquitto stores configuration, persistence data, and logs beneath the services root. The generated deployment requires a non-empty username and a sufficiently long password rather than enabling anonymous access.

Bootstrap/migration fallbacks:

```env
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

### Govee2MQTT

Managed Govee2MQTT uses host networking for LAN discovery/control and can receive MQTT/Govee credentials through the protected integration configuration path.

### Music Assistant

Existing Music Assistant containers can be adopted without recreation. A Hub-managed deployment uses host networking for local discovery and keeps Music Assistant `/data` under the managed services root.

Application fallback:

```env
MUSIC_ASSISTANT_URL=http://127.0.0.1:8095
```

### Veyon WebAPI

Veyon can use an already-running WebAPI service/container or the supported proxy add-on. Configure the application endpoint, key name, scan subnet/range, pool limits, and encrypted private key under **Settings → Integrations & Hardware**.

```env
VEYON_WEBAPI_URL=http://127.0.0.1:11080
VEYON_KEY_NAME=ClassroomControlHub
VEYON_SCAN_SUBNET=
```

## Pluto Mark I

Configure the endpoint, timeout, and read retries under **Settings → Integrations & Hardware**. Changes are validated, stored in SQLite, and applied live.

```env
PLUTO_URL=
PLUTO_TIMEOUT_MS=4000
PLUTO_READ_RETRIES=4
```

An unconfigured Pluto should be shown as `NOT CONFIGURED`, not continuously probed with an empty URL.

## Independent integration health

Each integration reports its own state. A Pluto failure must not make MQTT/Govee appear offline. Slow optional integration checks must not block initial Overview rendering.

Where practical, distinguish configured, connected/reachable, current state, last success, and last error.

## School and classroom identity

The Setup Wizard and controller Settings page store school/district name, classroom name, product name, logo, favicon, timezone, and theme values in persistent application state.

The product is intentionally education-specific and does not expose a neutral organization/site/space preset.

## Display configuration

Displays use stable receiver IDs. The Setup Wizard Receiver IDs field is editable rather than a disabled preview.

Rules:

- receiver IDs must be unique;
- editing the receiver list synchronizes the display count;
- changing the display count adds/removes trailing default IDs;
- saving a reduced receiver set prunes every display group's member list to IDs that still exist;
- friendly display names may change without changing receiver IDs or invalidating optional credentials.

Enabled receivers connect through their stable `/display/<id>` URL without credentials by default. **Settings → Classroom Display Access** offers optional one-use enrollment and a deliberate **Require individual display credentials** switch for environments that need per-browser revocation.

## Access profiles and passwords

Explicitly assigned profiles are authorization boundaries and fail closed. Alpha.71 startup recovery repairs built-in profiles only when their capability array is missing/empty/invalid. The Administrator profile must resolve to:

```json
{"capabilities":["*"]}
```

Valid non-empty customized capability arrays are not overwritten.

Passwords are opaque application strings. Characters such as `!`, `#`, `$`, quotes, backslashes, and semicolons are valid when they meet password-length policy. Shell troubleshooting must quote/read passwords safely because shell syntax is separate from browser/API password handling.

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

## Recovery controls

The main application owns SQLite. The maintenance layer uses the token-bound internal API for database status and application configuration, and the native Host Agent for approved host/Docker operations.

Every restore creates a pre-restore operational backup, validates archive paths and expanded size, verifies SQLite, and waits for application health after restart. Failed verification automatically restores the safety backup and reports the rollback outcome.

## Configuration validation

Before live deployment, verify:

1. no secrets are present in tracked files;
2. persistent directories and secret files are mounted;
3. timezone is correct;
4. `DATABASE_FILE` resolves to the intended live database;
5. Administrator has effective `*` capability;
6. receiver IDs/groups are internally consistent;
7. class/calendar rules resolve the expected current day;
8. integration endpoints are reachable from the correct host/container;
9. Host Agent and maintenance both see `/run/classroom-control-hub/host-agent.sock`;
10. optional managed add-ons preserve their data through an explicit recreate test before classroom reliance.
