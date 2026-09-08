[CmdletBinding()]
param(
  [Parameter(Mandatory)][uri]$HubUrl,
  [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9._-]{1,120}$')][string]$AgentId,
  [Parameter(Mandatory)][string]$EnrollmentToken,
  [string]$TrustedPublisherThumbprint='',
  [switch]$AllowHttp
)
$ErrorActionPreference='Stop'
if($HubUrl.Scheme -ne 'https' -and !$AllowHttp){throw 'HTTPS is required. Use -AllowHttp only on an isolated trusted classroom network.'}
if(!([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this installer in an elevated PowerShell window.'}
$root=Join-Path $env:ProgramData 'ClassroomControlHub';New-Item $root -ItemType Directory -Force|Out-Null
$agent=Join-Path $root 'ClassroomHubAgent.ps1';$config=Join-Path $root 'lab-agent.json'
$origin=$HubUrl.GetLeftPart([UriPartial]::Authority)
$manifest=Invoke-RestMethod ($origin+'/api/v1/lab-agent/manifest')
if(!$manifest.sha256 -or $manifest.sha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'Hub returned an invalid lab-agent manifest'}
$agentUri=$origin+'/lab-agent/ClassroomHubAgent.ps1';Invoke-WebRequest $agentUri -OutFile $agent
$actualHash=(Get-FileHash -LiteralPath $agent -Algorithm SHA256).Hash
if($actualHash -ne ([string]$manifest.sha256).ToUpperInvariant()){Remove-Item $agent -Force -ErrorAction SilentlyContinue;throw 'Downloaded agent failed SHA-256 verification'}
$signature=Get-AuthenticodeSignature $agent
if($TrustedPublisherThumbprint){if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $TrustedPublisherThumbprint){throw 'Downloaded agent does not have the required valid publisher signature'}}
@{hubUrl=$origin;agentId=$AgentId;enrollmentToken=$EnrollmentToken;credentialProtected='';trustedPublisherThumbprint=$TrustedPublisherThumbprint}|ConvertTo-Json|Set-Content $config -Encoding UTF8
& icacls.exe $root /inheritance:r /grant:r 'SYSTEM:(OI)(CI)(F)' 'Administrators:(OI)(CI)(F)' | Out-Null
$action="-NoProfile -ExecutionPolicy AllSigned -File `"$agent`" -ConfigPath `"$config`""
if(!$TrustedPublisherThumbprint){$action=$action -replace 'AllSigned','RemoteSigned'}
& schtasks.exe /Create /TN 'Classroom Control Hub Agent' /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "powershell.exe $action" /F | Out-Null
if(!(Get-EventLog -LogName Application -Source 'ClassroomHubAgent' -Newest 1 -ErrorAction SilentlyContinue)){New-EventLog -LogName Application -Source 'ClassroomHubAgent' -ErrorAction SilentlyContinue}
& schtasks.exe /Run /TN 'Classroom Control Hub Agent' | Out-Null
Write-Host "Classroom Control Hub agent installed for $AgentId. Enrollment completes when it connects."
