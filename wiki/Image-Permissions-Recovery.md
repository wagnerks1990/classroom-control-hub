# Image permissions and restart-loop recovery

When both core containers report `network=host` but the Hub restarts with `EACCES` opening `/app/src/server.js`, investigate source readability rather than changing network or database settings.

The corrected Dockerfile normalizes packaged source, assets and stock configuration to root-owned files `0644` and directories `0755`, then verifies readability under application UID/GID `10001:10001`. Host data, `.env`, backups, keys, runtime bind mounts and dependency executable modes are not loosened. Root-only host source (`0600` files and `0700` directories) is covered by a dedicated real-image CI build and HTTP smoke test.

Keep existing migration backups, preserve genuine local edits, pull the approved fix into a clean main checkout, and rebuild/recreate using the supported installer. Do not run the live application as root, delete a database, regenerate keys, or chmod the installation tree recursively. Existing images must be rebuilt: a restart alone retains the bad source layer. A bind mount masking packaged code/configuration is a separate permission boundary.

The generated `.classroom-hub-installation` marker is now ignored by Git; keep it. A healthy maintenance service does not establish that the Hub is healthy. Verify Hub health, stable restarts, both network modes, Host Agent and actual display/controller access before migrating add-ons.

Full diagnostic commands, build boundaries, recovery and test contract: [Image source permissions and restart-loop recovery](https://github.com/wagnerks1990/RoomGoblin/blob/main/docs/IMAGE-PERMISSIONS-RECOVERY.md).
