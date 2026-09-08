# Veyon and Music Assistant

## Veyon

Classroom Control Hub uses the native Ubuntu Veyon services when they are already installed:

```text
veyon.service
veyon-webapi.service
```

The Hub detects these services through the Host Agent and labels the integration **Host Managed**. Host Managed means Classroom Control Hub does not install, remove, or recreate the systemd services. It does **not** mean monitor-only: Veyon application configuration remains editable in Classroom Control Hub.

### Required Veyon settings

Open the Veyon WebAPI integration configuration and review:

- WebAPI URL (`http://host.docker.internal:11080` is the normal container-to-host value);
- Veyon authentication key name;
- Veyon private key;
- Veyon public key/deployment metadata;
- optional scan subnet and range;
- connection pool maximum;
- authentication retries;
- thumbnail concurrency.

The private authentication key is encrypted in the Classroom Control Hub SQLite database. The computer inventory is also database-backed. A legacy `veyon-computers.json` file is imported and retired during upgrade recovery.

### Domain and SSH credentials

Optional Windows/domain and Linux/SSH credentials are available for endpoint installation/configuration. They are not Veyon's normal control authentication method.

Veyon control authentication uses the Veyon key pair. Optional deployment credentials can include:

- Windows domain/workgroup, username and encrypted password;
- Linux SSH username, encrypted private key and optional encrypted passphrase.

### Existing computers

Existing database computers do not need to be rediscovered just because the scan subnet is blank. The Hub should preserve names, IP addresses, roles and discovery metadata through upgrades.

After saving Veyon configuration, the Hub probes the database inventory and reports counts for configured, online and authenticated computers. A `404` from `GET /` on port 11080 only proves the WebAPI process is reachable; it is not a successful control/authentication test.

## Music Assistant

Music Assistant can be deployed or an existing `music-assistant-server` container can be adopted. The container being present is not enough to mark the integration ready.

A valid long-lived Music Assistant access token is required.

### First setup

1. Install or adopt Music Assistant from **Discover & Configure Services** or **Infrastructure & Recovery**.
2. Choose **Open Music Assistant**.
3. Complete Music Assistant's own setup if needed.
4. In Music Assistant open **Settings → Profile → Long-lived access tokens**.
5. Create a token for Classroom Control Hub.
6. Return to Classroom Control Hub and paste the token into the Music Assistant configuration.
7. Choose **Save & Verify**.

The token is encrypted in the Classroom Control Hub database. Save & Verify performs an authenticated Music Assistant API check. Missing or rejected credentials leave the integration in setup-required/authentication-required state.

When the server-side URL uses `host.docker.internal:8095`, the Open Music Assistant button converts it to the current appliance hostname for browser access.

## Troubleshooting

Veyon host checks:

```bash
systemctl status veyon.service veyon-webapi.service --no-pager
ss -lntp | grep -E '11080|11100'
```

Music Assistant checks:

```bash
docker ps --filter name=music-assistant-server
ss -lntp | grep 8095
```

Classroom Control Hub checks:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

Do not deploy the old `veyon/webapi-proxy:latest` image when the native Veyon WebAPI service is present. Native service adoption is the supported appliance architecture.
