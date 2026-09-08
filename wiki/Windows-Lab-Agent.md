# Windows Classroom Lab Agent

The Windows agent provides constrained computer inventory and classroom actions;
it is not a general remote shell.

## Enrollment

1. Open **Lab → Agent Enrollment** as an administrator.
2. Generate the one-time enrollment command for the classroom computer.
3. Run it in an elevated PowerShell window before it expires.
4. Verify the new individual credential in the Hub, then disable the legacy
   shared-token policy after every computer has migrated.

The Hub stores only a credential hash. Windows protects the raw credential with
DPAPI Local Machine scope for the scheduled task. Revoking it in the GUI
disconnects the active computer and prevents reconnection.

As of alpha.69, the pending enrollment code is DPAPI-protected too, configuration
writes are atomic and restricted to System/Administrators, and the agent reports
its supported capabilities during connection.

Use HTTPS/WSS in production. Plain HTTP requires the explicit `-AllowHttp`
installer option and is intended only for trusted setup networks.

The default appliance certificate is issued by Caddy's internal CA. Install its
root certificate in **Local Computer → Trusted Root Certification Authorities**
before enrollment. The installer will not bypass an untrusted certificate. A
publicly trusted Hub certificate does not require this step.

Repository scripts are not Authenticode signed by default. A school can sign
the three scripts with its code-signing certificate and provide that publisher
thumbprint during installation; self-updates then require the matching valid
signature.

Browser history for Chrome, Edge, and Firefox requires a trusted `sqlite3.exe`
in `PATH`, `C:\Program Files\SQLite\`, or the agent `tools` directory. The agent
copies databases before reading them. Without SQLite it omits that capability and
returns an explicit dependency error.

Screen capture and locking run in the active user's session through short-lived
Task Scheduler actions. Instructor lock uses the Windows secure lock. Remote
unlock, custom passcodes/overlays, and application/site lock are intentionally
not implemented by this privileged agent; use Windows kiosk/AppLocker policy or
Veyon for those controls.

Updates are staged, hash/signature checked, atomically installed, restarted, and
rolled back if the new version does not reconnect within 60 seconds. Native
commands have timeouts and checked exit codes while agent heartbeats continue.

Detailed browsing history, screenshots, monitoring alerts, and Veyon
framebuffers require `lab.sensitive.read`. Configure their lifetimes under
**Settings → Student Data Retention**.
