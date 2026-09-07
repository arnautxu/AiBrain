$ErrorActionPreference='Stop'
$channel='\\tsclient\AiBrain'
$key=[Convert]::FromBase64String('__KEY__')
$roots=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ROOTS__'))|ConvertFrom-Json
$nonce='__NONCE__'
$maxBytes=__MAX_BYTES__
[Diagnostics.Process]::GetCurrentProcess().PriorityClass='BelowNormal'
function Pack($value) {
  $bytes=[Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Depth 8 -Compress))
  $h=New-Object Security.Cryptography.HMACSHA256(,$key)
  try {$mac=([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLower()} finally {$h.Dispose()}
  return (@{payload=[Convert]::ToBase64String($bytes);mac=$mac}|ConvertTo-Json -Compress)
}
function Unpack($file) {
  $raw=[IO.File]::ReadAllText($file)
  if($raw.Length-gt8192){throw 'FrameTooLarge'}
  $e=$raw|ConvertFrom-Json
  if($e.mac-notmatch'^[a-f0-9]{64}$'){throw 'Mac'}
  $bytes=[Convert]::FromBase64String($e.payload)
  $h=New-Object Security.Cryptography.HMACSHA256(,$key)
  try{$mac=([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLower()}finally{$h.Dispose()}
  $diff=0;for($j=0;$j-lt64;$j++){$diff=$diff-bor([int][char]$mac[$j]-bxor[int][char]$e.mac[$j])};if($diff-ne0){throw 'Mac'}
  return ([Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json)
}
function Respond($id,$value) {
  $tmp=$channel+'\response-'+$id+'.tmp';$out=$channel+'\response-'+$id+'.json'
  [IO.File]::WriteAllText($tmp,(Pack $value),[Text.Encoding]::UTF8)
  [IO.File]::Move($tmp,$out)
}
$work={param($d,$roots,$maxBytes,$channel)
  $ErrorActionPreference='Stop'
  $watch=[Diagnostics.Stopwatch]::StartNew()
  function Safe($path) {
    $p=[IO.Path]::GetFullPath($path)
    if($p-notmatch'^[A-Za-z]:\\'-or$p.Length-gt512){throw 'WINDOWS_PATH_UNAVAILABLE'}
    $allowed=$false
    foreach($b in $roots){$b=$b.TrimEnd('\');if($p-eq$b-or$p.StartsWith($b+'\',[StringComparison]::OrdinalIgnoreCase)){$allowed=$true}}
    if(!$allowed){throw 'WINDOWS_PATH_UNAVAILABLE'}
    foreach($part in $p.Substring(3).Split('\')){if($part.StartsWith('.')-or$part-match'(^|[._ -])(secrets?|credentials?|passwords?|passwd|tokens?|private.?key)([._ -]|$)'-or$part-match'[:*?<>|"\x00-\x1f]'){throw 'WINDOWS_PATH_UNAVAILABLE'}}
    $drive=Get-PSDrive -Name $p.Substring(0,1)
    if($drive.DisplayRoot-like'\\tsclient\*'){throw 'WINDOWS_PATH_UNAVAILABLE'}
    $c=$p;while($c){$i=Get-Item -Force -LiteralPath $c;if($i.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'WINDOWS_PATH_UNAVAILABLE'};$c=[IO.Path]::GetDirectoryName($c)}
    return $p
  }
  function Entry($i){@{source=$i.FullName;name=$i.Name;directory=$i.PSIsContainer;bytes=$(if($i.PSIsContainer){0}else{$i.Length});modifiedUtc=$i.LastWriteTimeUtc.ToString('o');reparse=[bool]($i.Attributes-band[IO.FileAttributes]::ReparsePoint)}}
  try {
    if($d.mode-notin@('drives','list','copy')){throw 'INVALID_SERVER_FILE_REQUEST'}
    $out=@();$partial=$false;$next=$null
    if($d.mode-eq'drives') {
      foreach($v in @(Get-PSDrive -PSProvider FileSystem|Where-Object{$_.Name-match'^[A-Za-z]$'-and$_.DisplayRoot-notlike'\\tsclient\*'})){
        try{$p=Safe $v.Root;$out+=@{source=$p;name=$v.Name;directory=$true;bytes=0;modifiedUtc=$null}}catch{}
      }
    } elseif($d.mode-eq'list') {
      if($d.limit-lt1-or$d.limit-gt50-or$d.offset-lt0-or$d.offset-gt50000){throw 'INVALID_SERVER_FILE_REQUEST'}
      $p=Safe $d.source
      $items=@(Get-ChildItem -Force -LiteralPath $p|Select-Object -First 50001|Sort-Object Name)
      $slice=@($items|Select-Object -Skip $d.offset -First ($d.limit+1))
      $out=@($slice|Select-Object -First $d.limit|ForEach-Object{Entry $_})
      $partial=$slice.Count-gt$d.limit-or$items.Count-ge50001
      if($slice.Count-gt$d.limit-and($d.offset+$d.limit)-lt50000){$next=$d.offset+$d.limit}
    } else {
      $p=Safe $d.source
      if([IO.Path]::GetExtension($p).ToLowerInvariant()-notin@('.pdf','.docx','.xlsx','.xlsm','.txt','.csv','.md','.json')){throw 'SERVER_FORMAT_NOT_READABLE'}
      $before=Get-Item -Force -LiteralPath $p
      if($before.PSIsContainer-or$before.Length-gt$maxBytes){throw 'SERVER_COPY_LIMIT'}
      $target=$channel+'\copy-'+$d.id
      $input=$null;$output=$null
      try {
        # Do not lock out an employee writing or replacing the source. Detect
        # a changed version after the bounded copy and reject it explicitly.
        $input=New-Object IO.FileStream($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite-bor[IO.FileShare]::Delete))
        $output=New-Object IO.FileStream($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $buffer=New-Object byte[] 65536;$total=0
        while(($n=$input.Read($buffer,0,$buffer.Length))-gt0){$total+=$n;if($total-gt$maxBytes-or$watch.Elapsed.TotalSeconds-gt25){throw 'SERVER_COPY_LIMIT'};$output.Write($buffer,0,$n)}
      } finally {if($output){$output.Dispose()};if($input){$input.Dispose()}}
      $after=Get-Item -Force -LiteralPath (Safe $p)
      if($total-ne$before.Length-or$after.Length-ne$before.Length-or$after.LastWriteTimeUtc-ne$before.LastWriteTimeUtc){throw 'SERVER_SOURCE_CHANGED'}
      $hash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
      $sourceHash=(Get-FileHash -LiteralPath (Safe $p) -Algorithm SHA256).Hash.ToLowerInvariant()
      if($sourceHash-ne$hash){throw 'SERVER_SOURCE_CHANGED'}
      return @{ok=$true;id=$d.id;source=$p;bytes=$total;sha256=$hash;modifiedUtc=$after.LastWriteTimeUtc.ToString('o');executionMs=$watch.ElapsedMilliseconds}
    }
    return @{ok=$true;entries=@($out);truncated=$partial;denied=0;nextOffset=$next;id=$d.id;executionMs=$watch.ElapsedMilliseconds}
  } catch {
    $code=$_.Exception.Message
    if($code-notin@('SERVER_FORMAT_NOT_READABLE','SERVER_SOURCE_CHANGED','SERVER_COPY_LIMIT','INVALID_SERVER_FILE_REQUEST')){$code='WINDOWS_PATH_UNAVAILABLE'}
    return @{ok=$false;error=$code;id=$d.id;executionMs=$watch.ElapsedMilliseconds}
  }
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
$administrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($identity.User.Value-ne'__SID__'-or$administrator){throw 'SERVER_CHANNEL_IDENTITY_UNVERIFIED'}
$pool=[RunspaceFactory]::CreateRunspacePool(1,4);$pool.Open()
$jobs=New-Object Collections.ArrayList
$seen=New-Object 'Collections.Generic.HashSet[string]'
$clock=[Diagnostics.Stopwatch]::StartNew();$stopping=$false
try {
  [IO.File]::WriteAllText($channel+'\ready.json',(Pack @{state='ready';nonce=$nonce;workers=4;ttlSeconds=90;accountSid=$identity.User.Value;administrator=$administrator}),[Text.Encoding]::UTF8)
  while(!$stopping-and$clock.Elapsed.TotalSeconds-lt90-and$seen.Count-lt120) {
    if([Diagnostics.Process]::GetCurrentProcess().PrivateMemorySize64-gt268435456){break}
    foreach($job in @($jobs)) {
      if(!$job.handle.IsCompleted-and([DateTime]::UtcNow-$job.started).TotalSeconds-gt30){$job.ps.Stop()}
      if($job.handle.IsCompleted) {
        try{$result=@($job.ps.EndInvoke($job.handle));$response=$result[-1];if(!$response){$response=@{ok=$false;error='SERVER_FILES_TIMEOUT';id=$job.id}};Respond $job.id $response}finally{$job.ps.Dispose();[void]$jobs.Remove($job)}
      }
    }
    foreach($f in @(Get-ChildItem -LiteralPath $channel -Filter 'request-*.json'|Select-Object -First 120)) {
      if($jobs.Count-ge4){break}
      if($f.Name-notmatch'^request-([a-f0-9]{32})\.json$'){continue};$id=$Matches[1]
      if($seen.Contains($id)){continue}
      try{$d=Unpack $f.FullName}catch{continue}
      if($d.id-ne$id-or$d.session-ne$nonce){continue}
      [void]$seen.Add($id)
      if($d.mode-eq'stop'){$stopping=$true;break}
      $ps=[PowerShell]::Create();$ps.RunspacePool=$pool;[void]$ps.AddScript($work.ToString()).AddArgument($d).AddArgument($roots).AddArgument($maxBytes).AddArgument($channel)
      [void]$jobs.Add(@{id=$id;ps=$ps;handle=$ps.BeginInvoke();started=[DateTime]::UtcNow})
    }
    Start-Sleep -Milliseconds 50
  }
} finally {
  foreach($job in @($jobs)){try{$job.ps.Stop()}finally{$job.ps.Dispose()}}
  $pool.Close();$pool.Dispose()
  [IO.File]::WriteAllText($channel+'\done.json',(Pack @{state='stopped';nonce=$nonce}),[Text.Encoding]::UTF8)
}
