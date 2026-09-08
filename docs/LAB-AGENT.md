# Windows Classroom Lab Agent

The optional Windows agent gives Classroom Control Hub a constrained way to
inventory classroom computers and run a small, reviewed command set. It is not
a general remote shell.

## Enroll a computer

1. Open **Lab → Agent Enrollment** as an administrator.
2. Select the classroom computer and create a one-time enrollment command.
3. Run the command in an elevated PowerShell window on that computer before the
   enrollment code expires.
4. Confirm that the computer appears with an individual credential, then turn
   off the legacy shared-token policy after all computers have migrated.

The one-time code is exchanged for a unique agent credential. The Hub stores
only its hash. Windows stores the credential with DPAPI using the Local Machine
scope so the scheduled task can reconnect after reboot. Revoking the credential
in the GUI disconnects the active agent and blocks future connections.

The alpha.70 agent also DPAPI-protects the pending one-time enrollment code and
writes its configuration through a restricted, atomic replacement. The agent
reports a capability list when it connects. Controllers should use that list to
avoid presenting actions that the computer cannot perform.

## Transport and signing

The current Classroom Control Hub appliance is temporarily HTTP-only while the
HTTPS/TLS gateway is redesigned. The Windows installer continues to reject plain
HTTP unless the administrator explicitly supplies `-AllowHttp`. This is an
intentional safety acknowledgement because enrollment credentials are otherwise
sent over an unencrypted LAN connection.

Use HTTP enrollment only on a trusted, isolated classroom/admin network. Do not
enroll agents across the public Internet or an untrusted Wi-Fi/VLAN.

Example:

```powershell
.\Install-Agent.ps1 -HubUrl http://172.16.127.5:3000 -AllowHttp
```

When HTTPS is reintroduced, the installer should return to HTTPS/WSS without
requiring `-AllowHttp`. Certificate trust/distribution guidance will be restored
at that time; there is no Caddy root CA in the current deployment architecture.

The repository scripts are development artifacts and are not Authenticode
signed by default. Schools that require publisher verification should sign
`ClassroomHubAgent.ps1`, `Install-Agent.ps1`, and `Uninstall-Agent.ps1` with
their code-signing certificate. Pass the allowed certificate thumbprint during
installation; agent updates then reject a script whose valid signature does not
match that publisher.

## Browser history dependency

Browser-history reporting is supported for Chromium, Microsoft Edge, and Firefox.
It copies each history database before reading it and never modifies the browser
profile. Install the official SQLite command-line client as `sqlite3.exe` in
`PATH`, `C:\Program Files\SQLite\sqlite3.exe`, or
`C:\ProgramData\ClassroomControlHub\tools\sqlite3.exe`. If it is absent, the
agent omits the history capability and a manual refresh returns an explicit
dependency error. Do not download an unverified SQLite executable from the web.

## Interactive-session actions

The main task runs as Local System. Screen capture and Windows locking are
therefore delegated through a short-lived Task Scheduler action running only in
the logged-on user's interactive session. Temporary JPEG files are held in the
restricted agent directory and deleted immediately after upload.

`instructor-lock` applies the Windows secure workstation lock. It deliberately
does not implement a custom unlock passcode, remote unlock, or a decorative lock
overlay because those designs weaken Windows authentication. Application/site
locking is also rejected by the constrained agent: deploy Windows kiosk/AppLocker
policy or use the supported Veyon control plane for that behavior.

## Updates and recovery

An agent update is downloaded to a restricted staging directory, checked against
the Hub SHA-256 manifest, and checked against the configured Authenticode publisher
when one is pinned. A detached updater atomically replaces the script, restarts
the scheduled task, and waits for the new agent version to reconnect. If that
health marker is not written within 60 seconds, it restores the previous script
and restarts the task again.

Native commands have explicit timeouts and their exit codes are checked. During a
long-running allowed command, the agent continues sending heartbeats. A command
that times out or exits unsuccessfully is reported as failed, not completed.

## Remove an agent

Run `Uninstall-Agent.ps1` as an administrator and revoke the corresponding
credential in the Hub. This removes the scheduled task and the protected local
credential files.

## Privacy

Agent access does not bypass Hub authorization. Detailed browser history,
screenshots, monitoring alerts, and Veyon framebuffer content require the
`lab.sensitive.read` capability. Configure and periodically review retention in
**Settings → Student Data Retention**.
