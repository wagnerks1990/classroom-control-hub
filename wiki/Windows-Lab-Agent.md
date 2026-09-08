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

Use HTTPS/WSS in production. Plain HTTP requires the explicit `-AllowHttp`
installer option and is intended only for trusted setup networks.

Repository scripts are not Authenticode signed by default. A school can sign
the three scripts with its code-signing certificate and provide that publisher
thumbprint during installation; self-updates then require the matching valid
signature.

Detailed browsing history, screenshots, monitoring alerts, and Veyon
framebuffers require `lab.sensitive.read`. Configure their lifetimes under
**Settings → Student Data Retention**.
