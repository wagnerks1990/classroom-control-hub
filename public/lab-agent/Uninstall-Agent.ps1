[CmdletBinding()]
param([switch]$KeepConfiguration)
$ErrorActionPreference='Stop'
if(!([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this uninstaller in an elevated PowerShell window.'}
$task=Get-ScheduledTask -TaskName 'Classroom Control Hub Agent' -ErrorAction SilentlyContinue
if($task){
  & schtasks.exe /End /TN 'Classroom Control Hub Agent' 2>$null
  if($LASTEXITCODE -notin @(0,1)){throw "Could not stop the agent task (schtasks exit code $LASTEXITCODE)."}
  & schtasks.exe /Delete /TN 'Classroom Control Hub Agent' /F 2>$null
  if($LASTEXITCODE -ne 0){throw "Could not delete the agent task (schtasks exit code $LASTEXITCODE)."}
}
Get-ScheduledTask -TaskName 'Classroom Hub Interactive *' -ErrorAction SilentlyContinue|Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
$root=Join-Path $env:ProgramData 'ClassroomControlHub'
if(Test-Path -LiteralPath $root){
  if($KeepConfiguration){
    # Preserve only the enrollment/configuration identity. Executables, health,
    # history snapshots, update staging, and captures must still be uninstalled.
    Get-ChildItem -LiteralPath $root -Force|Where-Object{$_.Name -ne 'lab-agent.json'}|Remove-Item -Recurse -Force -ErrorAction Stop
    $config=Join-Path $root 'lab-agent.json'
    if(Test-Path -LiteralPath $config){& icacls.exe $config /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)'|Out-Null;if($LASTEXITCODE -ne 0){throw 'Configuration was retained but its private ACL could not be verified.'}}
  }else{Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop}
}
Write-Host 'Classroom Control Hub agent removed. Revoke its credential in the web controller.'
