[CmdletBinding()]
param([string]$ConfigPath="$env:ProgramData\ClassroomControlHub\lab-agent.json")

$ErrorActionPreference='Stop'
$AgentVersion='1.0.0-alpha.70'
$script:ExitForUpdate=$false
$script:Socket=$null
$script:NextHeartbeat=[DateTime]::UtcNow
$script:NextHistoryPoll=[DateTime]::MaxValue
$script:UpdateInProgress=$false
$AgentCapabilities=@()
$NetworkTelemetry=@{ipv4=@();interactiveSession=$false;sqliteHistory=$false}
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
function Set-PrivateAcl([string]$Path,[bool]$Directory=$false){
  if($Directory){& icacls.exe $Path /inheritance:r /grant:r 'SYSTEM:(OI)(CI)(F)' 'Administrators:(OI)(CI)(F)' | Out-Null}
  else{& icacls.exe $Path /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null}
  if($LASTEXITCODE -ne 0){throw "Could not secure $Path"}
}
function Write-AtomicUtf8([string]$Path,[string]$Text){
  $dir=Split-Path -Parent $Path
  if(!(Test-Path -LiteralPath $dir)){New-Item -LiteralPath $dir -ItemType Directory -Force|Out-Null}
  Set-PrivateAcl $dir $true
  $temp=Join-Path $dir ('.'+[IO.Path]::GetFileName($Path)+'.'+[Guid]::NewGuid().ToString('N')+'.tmp')
  try{
    [IO.File]::WriteAllText($temp,$Text,[Text.UTF8Encoding]::new($false));Set-PrivateAcl $temp
    if(Test-Path -LiteralPath $Path){$backup=$Path+'.bak';Remove-Item $backup -Force -ErrorAction SilentlyContinue;[IO.File]::Replace($temp,$Path,$backup,$true);Set-PrivateAcl $Path}
    else{[IO.File]::Move($temp,$Path);Set-PrivateAcl $Path}
  }finally{Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
}
function Save-Config($Config){Write-AtomicUtf8 $ConfigPath ($Config|ConvertTo-Json -Depth 8)}
function Send-Json($Socket,$Value){
  $raw=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 12 -Compress))
  $segment=[ArraySegment[byte]]::new($raw)
  $Socket.SendAsync($segment,[Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
}
function Send-Heartbeat{
  if(!$script:Socket -or $script:Socket.State -ne [Net.WebSockets.WebSocketState]::Open){return}
  $os=Get-CimInstance Win32_OperatingSystem;$computer=Get-CimInstance Win32_ComputerSystem
  $uptime=[int](((Get-Date)-$os.LastBootUpTime).TotalSeconds)
  Send-Json $script:Socket @{type='heartbeat';hostname=$env:COMPUTERNAME;user=$computer.UserName;agentVersion=$AgentVersion;uptimeSeconds=$uptime;capabilities=$AgentCapabilities;meta=@{os=[Environment]::OSVersion.VersionString;ipv4=$NetworkTelemetry.ipv4;interactiveSession=$NetworkTelemetry.interactiveSession;sqliteHistory=$NetworkTelemetry.sqliteHistory}}
  $script:NextHeartbeat=[DateTime]::UtcNow.AddSeconds(15)
}
function Command-Result($Socket,$Command,[bool]$Ok,[string]$Message,$Result=$null){
  Send-Json $Socket @{type='lab.command.result';commandId=$Command.id;action=$Command.action;ok=$Ok;message=$Message;result=$Result}
}
function Send-AgentEvent([string]$Category,[string]$Message,[string]$Severity='info',$Details=$null){
  if(!$script:Socket -or $script:Socket.State -ne [Net.WebSockets.WebSocketState]::Open){return}
  try{Send-Json $script:Socket @{type='lab.agent.event';category=$Category;severity=$Severity;message=$Message;details=$Details;occurredAt=[DateTime]::UtcNow.ToString('o')}}catch{}
}
function Quote-NativeArgument([string]$Value){
  if($Value -notmatch '[\s"]'){return $Value}
  $escaped=[Text.RegularExpressions.Regex]::Replace($Value,'(\\*)"','$1$1\"')
  $escaped=[Text.RegularExpressions.Regex]::Replace($escaped,'(\\+)$','$1$1')
  return '"'+$escaped+'"'
}
function Invoke-NativeBounded([string]$FilePath,[string[]]$Arguments=@(),[int]$TimeoutSeconds=60){
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$FilePath
  $psi.Arguments=(($Arguments|ForEach-Object{Quote-NativeArgument ([string]$_)}) -join ' ')
  $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
  $process=[Diagnostics.Process]::new();$process.StartInfo=$psi
  try{
    if(!$process.Start()){throw "Could not start $FilePath"}
    $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
    $deadline=[DateTime]::UtcNow.AddSeconds([Math]::Max(1,$TimeoutSeconds))
    while(!$process.WaitForExit(1000)){
      if([DateTime]::UtcNow -ge $deadline){try{$process.Kill()}catch{};throw "$([IO.Path]::GetFileName($FilePath)) timed out after $TimeoutSeconds seconds"}
      if([DateTime]::UtcNow -ge $script:NextHeartbeat){Send-Heartbeat}
    }
    $process.WaitForExit();$out=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult()
    if($process.ExitCode -ne 0){throw "$([IO.Path]::GetFileName($FilePath)) failed with exit code $($process.ExitCode): $($err.Trim())"}
    return @{exitCode=$process.ExitCode;stdout=$out;stderr=$err}
  }finally{$process.Dispose()}
}
function Get-InteractiveUser{
  # Prefer the console/RDP session Windows itself reports as Active. Explorer.exe is
  # only a fallback because it may be absent, duplicated, or left behind at logoff.
  try{
    $lines=& "$env:SystemRoot\System32\quser.exe" 2>$null
    if($LASTEXITCODE -eq 0){
      foreach($line in @($lines|Select-Object -Skip 1)){
        $clean=([string]$line).TrimStart('>',' ')
        if($clean -match '^([^\s]+)\s+(?:[^\s]+\s+)?(\d+)\s+Active(?:\s|$)'){
          $account=$Matches[1];$sid=[int]$Matches[2]
          $p=Get-CimInstance Win32_Process -Filter "Name='explorer.exe'"|Where-Object{$_.SessionId -eq $sid}|Select-Object -First 1
          if($p){$owner=Invoke-CimMethod -InputObject $p -MethodName GetOwner;if($owner.User){$account=if($owner.Domain){$owner.Domain+'\'+$owner.User}else{$owner.User}}}
          return @{account=$account;sessionId=$sid}
        }
      }
    }
  }catch{}
  foreach($p in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'"|Where-Object{$_.SessionId -gt 0}|Sort-Object SessionId -Descending)){
    try{$owner=Invoke-CimMethod -InputObject $p -MethodName GetOwner;if($owner.User){$account=if($owner.Domain){$owner.Domain+'\'+$owner.User}else{$owner.User};return @{account=$account;sessionId=[int]$p.SessionId}}}catch{}
  }
  return $null
}
function Invoke-InteractiveTask([string]$Executable,[string]$Arguments,[int]$TimeoutSeconds=30){
  $user=Get-InteractiveUser;if(!$user){throw 'No interactive Windows user session is available'}
  if(!(Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)){throw 'Windows ScheduledTasks support is unavailable'}
  $name='Classroom Hub Interactive '+[Guid]::NewGuid().ToString('N')
  $action=New-ScheduledTaskAction -Execute $Executable -Argument $Arguments
  $principal=New-ScheduledTaskPrincipal -UserId $user.account -LogonType Interactive -RunLevel Limited
  try{
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Force|Out-Null;Start-ScheduledTask -TaskName $name
    $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do{Start-Sleep -Milliseconds 250;$task=Get-ScheduledTask -TaskName $name;if([DateTime]::UtcNow -ge $script:NextHeartbeat){Send-Heartbeat};if([DateTime]::UtcNow -ge $deadline){Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;throw "Interactive task timed out after $TimeoutSeconds seconds"}}while($task.State -eq 'Running' -or $task.State -eq 'Queued')
    $info=Get-ScheduledTaskInfo -TaskName $name
    if($info.LastTaskResult -ne 0){throw "Interactive task failed with result 0x$('{0:X8}' -f [uint32]$info.LastTaskResult)"}
  }finally{Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue}
}
function Capture-Screenshot([int]$Quality=70){
  $root=Split-Path -Parent $ConfigPath;$work=Join-Path $root 'interactive'
  if(!(Test-Path $work)){New-Item $work -ItemType Directory -Force|Out-Null}
  $user=Get-InteractiveUser;if(!$user){throw 'No interactive Windows user session is available for screen capture'}
  & icacls.exe $work /inheritance:r /grant:r 'SYSTEM:(OI)(CI)(F)' 'Administrators:(OI)(CI)(F)' "$($user.account):(OI)(CI)(M)" | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not prepare the protected interactive capture directory'}
  $file=Join-Path $work ('capture-'+[Guid]::NewGuid().ToString('N')+'.jpg')
  $path64=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($file));$q=[Math]::Max(25,[Math]::Min(90,$Quality))
  $helper=@"
`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Drawing;Add-Type -AssemblyName System.Windows.Forms
`$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('$path64'));`$b=[Windows.Forms.SystemInformation]::VirtualScreen
`$i=New-Object Drawing.Bitmap `$b.Width,`$b.Height;`$g=[Drawing.Graphics]::FromImage(`$i)
try{`$g.CopyFromScreen(`$b.Left,`$b.Top,0,0,`$i.Size);`$c=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object MimeType -eq 'image/jpeg';`$e=New-Object Drawing.Imaging.EncoderParameters 1;`$e.Param[0]=New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality),([long]$q);`$i.Save(`$p,`$c,`$e)}finally{`$g.Dispose();`$i.Dispose()}
"@
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))
  try{
    Invoke-InteractiveTask "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded" 30
    if(!(Test-Path $file)){throw 'Interactive capture did not produce an image'}
    $bytes=[IO.File]::ReadAllBytes($file)
    if($bytes.Length -lt 4 -or $bytes[0] -ne 0xFF -or $bytes[1] -ne 0xD8){throw 'Interactive capture did not produce a valid JPEG'}
    if($bytes.Length -gt 7MB){throw 'Screenshot exceeds the safe 7 MB upload limit; reduce the display resolution or capture quality'}
    return @{data=[Convert]::ToBase64String($bytes);bytes=$bytes.Length}
  }finally{Remove-Item $file -Force -ErrorAction SilentlyContinue;Set-PrivateAcl $work $true}
}
function Find-Sqlite3{
  $cmd=Get-Command sqlite3.exe -ErrorAction SilentlyContinue;if($cmd){return $cmd.Source}
  foreach($p in @("$env:ProgramFiles\SQLite\sqlite3.exe","$env:ProgramData\ClassroomControlHub\tools\sqlite3.exe")){if(Test-Path $p){return $p}}
  return ''
}
function Collect-BrowserHistory([int]$Limit=500){
  $sqlite=Find-Sqlite3;if(!$sqlite){throw 'Browser history requires sqlite3.exe in PATH or ProgramData\ClassroomControlHub\tools. No browser database was modified.'}
  $items=New-Object Collections.Generic.List[object];$root=Split-Path -Parent $ConfigPath;$tempDir=Join-Path $root 'history-temp'
  if(!(Test-Path $tempDir)){New-Item $tempDir -ItemType Directory -Force|Out-Null};Set-PrivateAcl $tempDir $true
  $profiles=Get-CimInstance Win32_UserProfile|Where-Object{!$_.Special -and $_.LocalPath -and (Test-Path $_.LocalPath)}
  foreach($profile in $profiles){
    $sources=@(
      @{browser='Chrome';pattern=Join-Path $profile.LocalPath 'AppData\Local\Google\Chrome\User Data\*\History';query="SELECT json_object('url',u.url,'title',u.title,'visitTime',strftime('%Y-%m-%dT%H:%M:%SZ',(v.visit_time/1000000)-11644473600,'unixepoch'),'visitCount',u.visit_count,'typedCount',u.typed_count,'recordId',v.id) FROM visits v JOIN urls u ON u.id=v.url ORDER BY v.visit_time DESC LIMIT $Limit;"},
      @{browser='Edge';pattern=Join-Path $profile.LocalPath 'AppData\Local\Microsoft\Edge\User Data\*\History';query="SELECT json_object('url',u.url,'title',u.title,'visitTime',strftime('%Y-%m-%dT%H:%M:%SZ',(v.visit_time/1000000)-11644473600,'unixepoch'),'visitCount',u.visit_count,'typedCount',u.typed_count,'recordId',v.id) FROM visits v JOIN urls u ON u.id=v.url ORDER BY v.visit_time DESC LIMIT $Limit;"},
      @{browser='Firefox';pattern=Join-Path $profile.LocalPath 'AppData\Roaming\Mozilla\Firefox\Profiles\*\places.sqlite';query="SELECT json_object('url',p.url,'title',p.title,'visitTime',strftime('%Y-%m-%dT%H:%M:%SZ',v.visit_date/1000000,'unixepoch'),'visitCount',p.visit_count,'typedCount',0,'recordId',v.id) FROM moz_historyvisits v JOIN moz_places p ON p.id=v.place_id ORDER BY v.visit_date DESC LIMIT $Limit;"}
    )
    foreach($source in $sources){foreach($db in Get-ChildItem -Path $source.pattern -File -ErrorAction SilentlyContinue){
      $copy=Join-Path $tempDir ([Guid]::NewGuid().ToString('N')+'.sqlite')
      try{
        Copy-Item $db.FullName $copy -Force
        # Chromium and Firefox may have committed rows in WAL while the browser is
        # open. Copy sidecars beside the snapshot so sqlite3 sees a consistent view.
        foreach($suffix in @('-wal','-shm')){if(Test-Path -LiteralPath ($db.FullName+$suffix)){Copy-Item -LiteralPath ($db.FullName+$suffix) -Destination ($copy+$suffix) -Force}}
        $run=Invoke-NativeBounded $sqlite @('-readonly',$copy,$source.query) 20
        foreach($line in ($run.stdout -split "`r?`n")){if(!$line.Trim()){continue};try{$row=$line|ConvertFrom-Json;$items.Add(@{id="$($source.browser)-$($profile.SID)-$($row.recordId)";url=[string]$row.url;title=[string]$row.title;visitTime=[string]$row.visitTime;visitCount=[int]$row.visitCount;typedCount=[int]$row.typedCount;browser=$source.browser;profile=[IO.Path]::GetFileName($profile.LocalPath);browserProfile=$db.Directory.Name;historyFile=$db.FullName;recordId=[string]$row.recordId})}catch{}}
      }catch{Send-AgentEvent 'browser-history' "Could not read $($source.browser) history for profile $([IO.Path]::GetFileName($profile.LocalPath)): $($_.Exception.Message)" 'warning'}
      finally{Remove-Item $copy,($copy+'-wal'),($copy+'-shm') -Force -ErrorAction SilentlyContinue}
    }}
  }
  return @($items|Sort-Object visitTime -Descending|Select-Object -First $Limit)
}
function Send-BrowserHistory{$items=Collect-BrowserHistory 500;Send-Json $script:Socket @{type='lab.history';items=$items};$script:NextHistoryPoll=[DateTime]::UtcNow.AddSeconds(60);return $items.Count}
function Get-AgentCapabilities{
  $caps=@('message','restart','shutdown','cancel-shutdown','run-preset','update-agent')
  if(Get-InteractiveUser){$caps+=@('lock','logoff','screenshot','instructor-lock')};if(Find-Sqlite3){$caps+=@('refresh-history','browser-history')};return $caps
}
function Get-NetworkTelemetry{
  $addresses=@()
  try{$addresses=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop|Where-Object{$_.IPAddress -and $_.IPAddress -notlike '127.*' -and $_.AddressState -eq 'Preferred'}|Sort-Object InterfaceMetric|Select-Object -ExpandProperty IPAddress -Unique)}catch{
    try{$addresses=@([Net.Dns]::GetHostAddresses($env:COMPUTERNAME)|Where-Object{$_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and !$_.IPAddressToString.StartsWith('127.')}|ForEach-Object{$_.IPAddressToString})}catch{}
  }
  return @{ipv4=$addresses;interactiveSession=[bool](Get-InteractiveUser);sqliteHistory=[bool](Find-Sqlite3)}
}
function Start-AgentUpdate($Manifest,$Stage){
  if($script:UpdateInProgress){throw 'An agent update is already in progress'}
  $script:UpdateInProgress=$true
  $root=Split-Path -Parent $ConfigPath;$updateDir=Join-Path $root 'updates'
  if(!(Test-Path $updateDir)){New-Item $updateDir -ItemType Directory -Force|Out-Null};Set-PrivateAcl $updateDir $true
  $staged=Join-Path $updateDir ('ClassroomHubAgent.'+[Guid]::NewGuid().ToString('N')+'.ps1');Move-Item $Stage $staged -Force;Set-PrivateAcl $staged
  $marker=Join-Path $root 'agent-health.json';Remove-Item $marker -Force -ErrorAction SilentlyContinue
  $values=@($PID,$staged,$PSCommandPath,$marker,[string]$Manifest.sha256,[string]$Manifest.version)|ForEach-Object{[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$_))}
  $updater=@"
`$ErrorActionPreference='Stop';`$v=@('$($values -join "','")')|ForEach-Object{[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(`$_))}
`$pidToWait=[int]`$v[0];`$stage=`$v[1];`$target=`$v[2];`$marker=`$v[3];`$hash=`$v[4].ToUpperInvariant();`$version=`$v[5];`$backup=`$target+'.previous'
try{for(`$i=0;`$i -lt 120 -and (Get-Process -Id `$pidToWait -ErrorAction SilentlyContinue);`$i++){Start-Sleep -Milliseconds 250};if(Get-Process -Id `$pidToWait -ErrorAction SilentlyContinue){throw 'Previous agent process did not exit'};if((Get-FileHash `$stage -Algorithm SHA256).Hash -ne `$hash){throw 'Staged agent hash changed'};Remove-Item `$backup -Force -ErrorAction SilentlyContinue;[IO.File]::Replace(`$stage,`$target,`$backup,`$true);& schtasks.exe /Run /TN 'Classroom Control Hub Agent'|Out-Null;if(`$LASTEXITCODE -ne 0){throw "Updated agent task failed to start (exit code `$LASTEXITCODE)"};`$ok=`$false;for(`$i=0;`$i -lt 60;`$i++){Start-Sleep 1;try{`$h=Get-Content `$marker -Raw|ConvertFrom-Json;if(`$h.version -eq `$version){`$ok=`$true;break}}catch{}};if(!`$ok){Copy-Item `$backup `$target -Force;& schtasks.exe /End /TN 'Classroom Control Hub Agent' 2>`$null;& schtasks.exe /Run /TN 'Classroom Control Hub Agent'|Out-Null;if(`$LASTEXITCODE -ne 0){throw "Rollback agent task failed to start (exit code `$LASTEXITCODE)"};throw 'Updated agent failed its health check and was rolled back'}}catch{Write-EventLog -LogName Application -Source 'ClassroomHubAgent' -EntryType Error -EventId 1002 -Message ("Agent update failed: "+`$_.Exception.Message) -ErrorAction SilentlyContinue}finally{Remove-Item `$stage -Force -ErrorAction SilentlyContinue}
"@
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($updater))
  try{Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded" -WindowStyle Hidden -ErrorAction Stop|Out-Null}
  catch{$script:UpdateInProgress=$false;throw}
}
function Invoke-AgentCommand($Socket,$Command,$Config){
  try{
    switch([string]$Command.action){
      'message' {$text=[string]$Command.payload.text;if($text.Length -gt 2000){throw 'Message exceeds the 2,000-character Windows delivery limit'};[void](Invoke-NativeBounded "$env:SystemRoot\System32\msg.exe" @('*','/TIME:120',$text) 15);Command-Result $Socket $Command $true 'Message displayed'}
      'restart' {[void](Invoke-NativeBounded "$env:SystemRoot\System32\shutdown.exe" @('/r','/t','30','/d','p:4:1','/c','Classroom Control Hub administrator request') 10);Command-Result $Socket $Command $true 'Restart scheduled'}
      'shutdown' {[void](Invoke-NativeBounded "$env:SystemRoot\System32\shutdown.exe" @('/s','/t','30','/d','p:4:1','/c','Classroom Control Hub administrator request') 10);Command-Result $Socket $Command $true 'Shutdown scheduled'}
      'cancel-shutdown' {[void](Invoke-NativeBounded "$env:SystemRoot\System32\shutdown.exe" @('/a') 10);Command-Result $Socket $Command $true 'Pending shutdown cancelled'}
      'logoff' {$user=Get-InteractiveUser;if(!$user){throw 'No interactive Windows session is available'};[void](Invoke-NativeBounded "$env:SystemRoot\System32\logoff.exe" @([string]$user.sessionId) 10);Command-Result $Socket $Command $true "Interactive session $($user.sessionId) logged off"}
      'lock' {Invoke-InteractiveTask "$env:SystemRoot\System32\rundll32.exe" 'user32.dll,LockWorkStation' 15;Command-Result $Socket $Command $true 'Interactive workstation locked'}
      'instructor-lock' {Invoke-InteractiveTask "$env:SystemRoot\System32\rundll32.exe" 'user32.dll,LockWorkStation' 15;Command-Result $Socket $Command $true 'Windows secure lock applied. Custom image, message, timer, and passcode are intentionally not used.'}
      'instructor-unlock' {throw 'Windows secure workstations cannot be remotely unlocked safely. The student or administrator must authenticate.'}
      'app-lock' {throw 'Application/site lock requires Windows kiosk or AppLocker policy and is not enabled by this constrained agent. Use Veyon or managed Windows policy.'}
      'app-unlock' {throw 'No agent application lock was applied. Remove the managed kiosk/AppLocker policy through its management system.'}
      'refresh-history' {$count=Send-BrowserHistory;Command-Result $Socket $Command $true "$count browser history records reported"}
      'screenshot' {$capture=Capture-Screenshot ([int]$Command.payload.quality);Send-Json $Socket @{type='lab.screenshot';data=$capture.data;save=($Command.payload.save -eq $true);alertId=[string]$Command.payload.alertId};Command-Result $Socket $Command $true "Screenshot captured ($($capture.bytes) bytes)"}
      'run-preset' {
        switch([string]$Command.payload.preset){'gpupdate' {$r=Invoke-NativeBounded "$env:SystemRoot\System32\gpupdate.exe" @('/force') 120};'flushdns' {$r=Invoke-NativeBounded "$env:SystemRoot\System32\ipconfig.exe" @('/flushdns') 30};'renew-network' {$r=Invoke-NativeBounded "$env:SystemRoot\System32\ipconfig.exe" @('/renew') 90};'system-info' {$r=Invoke-NativeBounded "$env:SystemRoot\System32\systeminfo.exe" @() 60};default {throw 'Unsupported preset'}}
        Command-Result $Socket $Command $true (($r.stdout+$r.stderr).Trim())
      }
      'update-agent' {
        if($script:UpdateInProgress){throw 'An agent update is already in progress'}
        $origin=([uri]$Config.hubUrl).GetLeftPart([UriPartial]::Authority)
        try{$manifest=Invoke-RestMethod ($origin+'/api/v1/lab-agent/manifest') -TimeoutSec 20}catch{throw "Could not retrieve the agent manifest over trusted TLS: $($_.Exception.Message)"}
        if(!$manifest.sha256 -or $manifest.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or [string]$manifest.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$'){throw 'Hub returned an invalid lab-agent manifest'}
        $temp=Join-Path $env:TEMP ('ClassroomHubAgent.'+[Guid]::NewGuid().ToString('N')+'.update.ps1')
        try{Invoke-WebRequest ($origin+'/lab-agent/ClassroomHubAgent.ps1') -OutFile $temp -TimeoutSec 30;$actualHash=(Get-FileHash $temp -Algorithm SHA256).Hash
          if($actualHash -ne ([string]$manifest.sha256).ToUpperInvariant()){throw 'Agent update failed SHA-256 verification'}
          $signature=Get-AuthenticodeSignature $temp
          if($Config.trustedPublisherThumbprint -and (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $Config.trustedPublisherThumbprint -or $signature.Status -ne 'Valid')){throw 'Agent update does not have the required valid publisher signature'}
          Send-AgentEvent 'agent-update' "Agent update to $($manifest.version) verified and is being staged" 'info'
          Start-AgentUpdate $manifest $temp;$script:ExitForUpdate=$true
          try{Command-Result $Socket $Command $true "Agent update to $($manifest.version) staged; restarting"}catch{}
        }catch{$script:UpdateInProgress=$false;Remove-Item $temp -Force -ErrorAction SilentlyContinue;Send-AgentEvent 'agent-update' $_.Exception.Message 'error';throw}
      }
      default {throw 'Command is not supported by this signed agent build'}
    }
  }catch{Command-Result $Socket $Command $false $_.Exception.Message}
}

while($true){
  try{
    if(!(Test-Path $ConfigPath)){throw "Agent configuration not found: $ConfigPath"}
    $config=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
    if(!($config.PSObject.Properties.Name -contains 'enrollmentTokenProtected')){$config|Add-Member -MemberType NoteProperty -Name enrollmentTokenProtected -Value ''}
    $credential=Unprotect-Secret ([string]$config.credentialProtected)
    $enrollment=if($config.enrollmentTokenProtected){Unprotect-Secret ([string]$config.enrollmentTokenProtected)}else{[string]$config.enrollmentToken}
    if($config.enrollmentToken -and !$config.enrollmentTokenProtected){$config.enrollmentTokenProtected=Protect-Secret ([string]$config.enrollmentToken);$config.enrollmentToken='';Save-Config $config;Remove-Item ($ConfigPath+'.bak') -Force -ErrorAction SilentlyContinue}
    $wsUri=([string]$config.hubUrl -replace '^https:','wss:' -replace '^http:','ws:').TrimEnd('/')+'/ws'
    $socket=[Net.WebSockets.ClientWebSocket]::new();$script:Socket=$socket;$socket.Options.KeepAliveInterval=[TimeSpan]::FromSeconds(15)
    $socket.ConnectAsync([uri]$wsUri,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $AgentCapabilities=Get-AgentCapabilities
    $NetworkTelemetry=Get-NetworkTelemetry
    Send-Json $socket @{type='hello';role='lab-agent';agentId=$config.agentId;hostname=$env:COMPUTERNAME;agentVersion=$AgentVersion;credential=$credential;enrollmentToken=$enrollment;capabilities=$AgentCapabilities;meta=@{os=[Environment]::OSVersion.VersionString;ipv4=$NetworkTelemetry.ipv4;interactiveSession=$NetworkTelemetry.interactiveSession;sqliteHistory=$NetworkTelemetry.sqliteHistory}}
    $script:NextHeartbeat=[DateTime]::UtcNow.AddSeconds(15);$buffer=New-Object byte[] 1048576
    while($socket.State -eq [Net.WebSockets.WebSocketState]::Open){
      $segment=[ArraySegment[byte]]::new($buffer);$receive=$socket.ReceiveAsync($segment,[Threading.CancellationToken]::None)
      while(!$receive.IsCompleted){$winner=[Threading.Tasks.Task]::WhenAny($receive,[Threading.Tasks.Task]::Delay(1000)).GetAwaiter().GetResult();if($winner -ne $receive){if([DateTime]::UtcNow -ge $script:NextHeartbeat){Send-Heartbeat};if([DateTime]::UtcNow -ge $script:NextHistoryPoll){try{[void](Send-BrowserHistory)}catch{$script:NextHistoryPoll=[DateTime]::UtcNow.AddSeconds(60)}}}}
      $result=$receive.GetAwaiter().GetResult();if($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){break}
      $message=New-Object IO.MemoryStream
      try{$message.Write($buffer,0,$result.Count);while(!$result.EndOfMessage){if($message.Length -ge 4MB){throw 'WebSocket message exceeds 4 MB'};$segment=[ArraySegment[byte]]::new($buffer);$result=$socket.ReceiveAsync($segment,[Threading.CancellationToken]::None).GetAwaiter().GetResult();if($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){break};if($message.Length+$result.Count -gt 4MB){throw 'WebSocket message exceeds 4 MB'};$message.Write($buffer,0,$result.Count)};if($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){break};$json=[Text.Encoding]::UTF8.GetString($message.ToArray())|ConvertFrom-Json}finally{$message.Dispose()}
      if($json.type -eq 'hello.ack'){
        if($json.credential){$config.credentialProtected=Protect-Secret ([string]$json.credential);$config.enrollmentToken='';$config.enrollmentTokenProtected='';Save-Config $config}
        $poll=[Math]::Max(30,[int]($json.historyPollSeconds));$script:NextHistoryPoll=if($json.historyEnabled -eq $false -or !(Find-Sqlite3)){[DateTime]::MaxValue}else{[DateTime]::UtcNow.AddSeconds($poll)}
        Write-AtomicUtf8 (Join-Path (Split-Path -Parent $ConfigPath) 'agent-health.json') (@{version=$AgentVersion;connectedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json)
      }
      if($json.type -eq 'lab.command'){Invoke-AgentCommand $socket $json.command $config;if($script:ExitForUpdate){return}}
    }
  }catch{$eventMessage=$_.Exception.Message;if($eventMessage -match 'certificate|trust relationship|SSL|TLS'){$eventMessage+=' Install the Classroom Control Hub Caddy root CA in Local Computer > Trusted Root Certification Authorities, or use a publicly trusted certificate.'};Write-EventLog -LogName Application -Source 'ClassroomHubAgent' -EntryType Error -EventId 1001 -Message $eventMessage -ErrorAction SilentlyContinue}
  finally{if($script:Socket){try{$script:Socket.Dispose()}catch{};$script:Socket=$null}}
  Start-Sleep -Seconds 10
}
