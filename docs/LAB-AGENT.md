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

## Transport and signing

Use HTTPS/WSS in production. The installer rejects plain HTTP unless the
administrator explicitly supplies `-AllowHttp`, which is intended only for a
trusted setup network.

The repository scripts are development artifacts and are not Authenticode
signed by default. Schools that require publisher verification should sign
`ClassroomHubAgent.ps1`, `Install-Agent.ps1`, and `Uninstall-Agent.ps1` with
their code-signing certificate. Pass the allowed certificate thumbprint during
installation; agent updates then reject a script whose valid signature does not
match that publisher.

## Remove an agent

Run `Uninstall-Agent.ps1` as an administrator and revoke the corresponding
credential in the Hub. This removes the scheduled task and the protected local
credential files.

## Privacy

Agent access does not bypass Hub authorization. Detailed browser history,
screenshots, monitoring alerts, and Veyon framebuffer content require the
`lab.sensitive.read` capability. Configure and periodically review retention in
**Settings → Student Data Retention**.
