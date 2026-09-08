[CmdletBinding()]
param([switch]$KeepConfiguration)
$ErrorActionPreference='Stop'
if(!([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this uninstaller in an elevated PowerShell window.'}
& schtasks.exe /End /TN 'Classroom Control Hub Agent' 2>$null
& schtasks.exe /Delete /TN 'Classroom Control Hub Agent' /F 2>$null
Get-ScheduledTask -TaskName 'Classroom Hub Interactive *' -ErrorAction SilentlyContinue|Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
if(!$KeepConfiguration){Remove-Item (Join-Path $env:ProgramData 'ClassroomControlHub') -Recurse -Force -ErrorAction SilentlyContinue}
Write-Host 'Classroom Control Hub agent removed. Revoke its credential in the web controller.'
