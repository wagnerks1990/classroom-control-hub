# GitHub Migration

The public repository intentionally contains generic defaults. Do not publish a production `.env`, database, private keys, backups, internal IP mappings, or site-specific credentials.

## Existing server

Before switching an existing installation to Git-based updates:

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-pre-github-$(date +%Y%m%d-%H%M%S)"
```

Keep these production files/data outside Git:

- `.env`
- `data/`
- production databases
- private keys and encryption master keys
- backups
- local site/hardware configuration

The public repository should remain generic. Site-specific configuration belongs in local runtime configuration and environment variables.

## Development clone

```bash
git clone https://github.com/wagnerks1990/classroom-control-hub.git
cd classroom-control-hub
cp .env.example .env
```

For production, edit `.env` locally and never commit it.
