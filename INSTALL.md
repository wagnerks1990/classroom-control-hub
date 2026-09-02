# Installation and Migration

## Existing Classroom Control Hub deployment

Extract the release on the Classroom Control Hub server and run:

```bash
sudo bash classroom-hub/install.sh
```

The installer:

1. Detects `/opt/classroom-control-hub` and the configured services-stack directory (legacy Classroom installs default to `/opt/services`).
2. Creates `/opt/classroom-control-hub-backups/migration-<timestamp>/`.
3. Preserves the existing Classroom Control Hub `data/`, `.env`, `config/devices.json`, and `config/hardware.json`.
4. Leaves the existing services-stack runtime data in place.
5. Merges the 1.0 application and maintenance agent.
6. Generates `MAINTENANCE_TOKEN` if needed.
7. Builds and starts the Classroom Control Hub and maintenance-agent containers.
8. Validates `/health` before reporting success.

Existing Mosquitto, Govee2MQTT, Node-RED and other containers are not deleted. They can be adopted into management from **System Management → Managed Integrations**.

## New deployment

The same installer can deploy to an empty `/opt/classroom-control-hub`. Copy `.env.example` values are created automatically. Site configuration can then be managed through the web controller.

## Rollback

The installer prints the pre-migration backup directory. If a migration fails, stop the new stack, restore the saved Classroom Control Hub directory, and start the prior Compose configuration.
