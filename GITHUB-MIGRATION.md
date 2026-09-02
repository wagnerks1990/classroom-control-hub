# Migrating an Existing Classroom Control Hub Installation

The public GitHub repository intentionally contains generic defaults. Do not overwrite your production `.env`, database, hardware mappings, or secrets with repository examples.

## Existing server

Before switching the installation to Git-based updates:

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-pre-github-$(date +%Y%m%d-%H%M%S)"
```

Keep these production files/data outside Git:

- `.env`
- `data/`
- production databases
- private keys and master keys
- backups
- local hardware/site configuration

The public repository should remain generic. Site-specific configuration belongs in local runtime configuration and environment variables.

## Development clone

```bash
git clone https://github.com/wagnerks1990/classroom-control-hub.git
cd classroom-control-hub
cp .env.example .env
```

For production, edit `.env` locally and never commit it.
