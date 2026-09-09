# AI context: image permissions

The canonical incident/recovery and contributor contract is [IMAGE-PERMISSIONS-RECOVERY.md](IMAGE-PERMISSIONS-RECOVERY.md). This supplements AGENTS.md and AI-CONTEXT.md; it does not replace the host-network, host-group, database or Android/Google TV persistence contracts.

An observed `EACCES` opening `/app/src/server.js` after a successful image build is a packaged source access failure. Docker COPY can retain restrictive local modes. Do not infer database corruption, failed host networking, lost pairing or invalid credentials from it. The original host file mode was not supplied in the incident log.

Keep packaged source/assets root-owned but readable by application UID/GID 10001. Normalize only declared image code/asset/config/build-tool paths (0644 files, 0755 directories), and run `tools/verify-image-permissions.js` after USER 10001 during image build. Do not grant root, mutate runtime secrets/data, recursively chmod the checkout, or strip dependency executable bits. Live bind mounts remain a separate permission boundary.

Keep the installer marker ignored, and retain the restrictive-context workflow that builds from 0600/0700 source and exercises real HTTP startup. Tests passing on a clean checkout are insufficient evidence for root-edited appliances. Never claim a Git merge, image build, or maintenance health check establishes successful live deployment.
