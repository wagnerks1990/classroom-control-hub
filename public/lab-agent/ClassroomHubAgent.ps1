[CmdletBinding()]
param([string]$ConfigPath="$env:ProgramData\ClassroomControlHub\lab-agent.json")

$ErrorActionPreference='Stop'
$AgentVersion='1.0.0-alpha.68'
[void][Reflection.Assembly]::LoadWithPartialName('System.Security')

function Protect-Secret([string]$Value){
  $bytes=[Text.Encoding]::UTF8.GetBytes($Value)
  [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine))
}
function Unprotect-Secret([string]$Value){
  if(!$Value){return ''}
  $bytes=[Convert]::FromBase64String($Value)
  [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine))
}
function Send-Json($Socket,$Value){
  $raw=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 12 -Compress))
  $segment=[ArraySegment[byte]]::new($raw)
  $Socket.SendAsync($segment,[Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
}
function Save-Config($Config){
  $Config|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  & icacls.exe $ConfigPath /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null
}
function Command-Result($Socket,$Command,[bool]$Ok,[string]$Message,$Result=$null){
  Send-Json $Socket @{type='lab.command.result';commandId=$Command.id;action=$Command.action;ok=$Ok;message=$Message;result=$Result}
}
function Invoke-AgentCommand($Socket,$Command,$Config){
  try{
    switch([string]$Command.action){
      'message' { & msg.exe '*' /TIME:120 ([string]$Command.payload.text); Command-Result $Socket $Command $true 'Message displayed' }
      'restart' { & shutdown.exe /r /t 30 /d p:4:1 /c 'Classroom Control Hub administrator request'; Command-Result $Socket $Command $true 'Restart scheduled' }
      'shutdown' { & shutdown.exe /s /t 30 /d p:4:1 /c 'Classroom Control Hub administrator request'; Command-Result $Socket $Command $true 'Shutdown scheduled' }
      'cancel-shutdown' { & shutdown.exe /a; Command-Result $Socket $Command $true 'Pending shutdown cancelled' }
      'logoff' { & shutdown.exe /l; Command-Result $Socket $Command $true 'Logoff requested' }
      'lock' { & rundll32.exe user32.dll,LockWorkStation; Command-Result $Socket $Command $true 'Workstation lock requested' }
      'run-preset' {
        switch([string]$Command.payload.preset){
          'gpupdate' { $out=& gpupdate.exe /force 2>&1 }
          'flushdns' { $out=& ipconfig.exe /flushdns 2>&1 }
          'renew-network' { $out=& ipconfig.exe /renew 2>&1 }
          'system-info' { $out=& systeminfo.exe 2>&1 }
          default { throw 'Unsupported preset' }
        }
        Command-Result $Socket $Command $true (($out|Out-String).Trim())
      }
      'update-agent' {
        $origin=([uri]$Config.hubUrl).GetLeftPart([UriPartial]::Authority)
        $manifest=Invoke-RestMethod ($origin+'/api/v1/lab-agent/manifest')
        if(!$manifest.sha256 -or $manifest.sha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'Hub returned an invalid lab-agent manifest'}
        $uri=$origin+'/lab-agent/ClassroomHubAgent.ps1'
        $temp=Join-Path $env:TEMP 'ClassroomHubAgent.update.ps1';Invoke-WebRequest $uri -OutFile $temp
        $actualHash=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash
        if($actualHash -ne ([string]$manifest.sha256).ToUpperInvariant()){Remove-Item $temp -Force -ErrorAction SilentlyContinue;throw 'Agent update failed SHA-256 verification'}
        $signature=Get-AuthenticodeSignature $temp
        if($Config.trustedPublisherThumbprint -and $signature.SignerCertificate.Thumbprint -ne $Config.trustedPublisherThumbprint){throw 'Agent update signer does not match the configured publisher'}
        if($Config.trustedPublisherThumbprint -and $signature.Status -ne 'Valid'){throw "Agent update signature is $($signature.Status)"}
        Copy-Item $temp $PSCommandPath -Force;Command-Result $Socket $Command $true 'Agent updated; reconnecting';$Socket.Abort()
      }
      default { throw 'Command is not supported by this signed agent build' }
    }
  }catch{Command-Result $Socket $Command $false $_.Exception.Message}
}

while($true){
  try{
    if(!(Test-Path $ConfigPath)){throw "Agent configuration not found: $ConfigPath"}
    $config=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
    $credential=Unprotect-Secret ([string]$config.credentialProtected)
    $wsUri=([string]$config.hubUrl -replace '^https:','wss:' -replace '^http:','ws:').TrimEnd('/')+'/ws'
    $socket=[Net.WebSockets.ClientWebSocket]::new();$socket.Options.KeepAliveInterval=[TimeSpan]::FromSeconds(15)
    $socket.ConnectAsync([uri]$wsUri,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
    Send-Json $socket @{type='hello';role='lab-agent';agentId=$config.agentId;hostname=$env:COMPUTERNAME;agentVersion=$AgentVersion;credential=$credential;enrollmentToken=[string]$config.enrollmentToken;meta=@{os=[Environment]::OSVersion.VersionString}}
    $buffer=New-Object byte[] 1048576
    while($socket.State -eq [Net.WebSockets.WebSocketState]::Open){
      $segment=[ArraySegment[byte]]::new($buffer);$receive=$socket.ReceiveAsync($segment,[Threading.CancellationToken]::None)
      while(!$receive.IsCompleted){
        $winner=[Threading.Tasks.Task]::WhenAny($receive,[Threading.Tasks.Task]::Delay(15000)).GetAwaiter().GetResult()
        if($winner -ne $receive){$uptime=[int](((Get-Date)-(Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds);Send-Json $socket @{type='heartbeat';hostname=$env:COMPUTERNAME;user=(Get-CimInstance Win32_ComputerSystem).UserName;agentVersion=$AgentVersion;uptimeSeconds=$uptime;meta=@{os=[Environment]::OSVersion.VersionString}}}
      }
      $result=$receive.GetAwaiter().GetResult();if($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){break}
      $message=New-Object IO.MemoryStream
      $message.Write($buffer,0,$result.Count)
      while(!$result.EndOfMessage){
        if($message.Length -gt 4MB){throw 'WebSocket message exceeds 4 MB'}
        $segment=[ArraySegment[byte]]::new($buffer);$result=$socket.ReceiveAsync($segment,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
        if($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){break}
        $message.Write($buffer,0,$result.Count)
      }
      if($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){$message.Dispose();break}
      $json=[Text.Encoding]::UTF8.GetString($message.ToArray())|ConvertFrom-Json;$message.Dispose()
      if($json.type -eq 'hello.ack' -and $json.credential){$config.credentialProtected=Protect-Secret ([string]$json.credential);$config.enrollmentToken='';Save-Config $config}
      if($json.type -eq 'lab.command'){Invoke-AgentCommand $socket $json.command $config}
    }
  }catch{Write-EventLog -LogName Application -Source 'ClassroomHubAgent' -EntryType Error -EventId 1001 -Message $_.Exception.Message -ErrorAction SilentlyContinue}
  Start-Sleep -Seconds 10
}
