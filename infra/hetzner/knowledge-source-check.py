#!/usr/bin/env python3
"""Fixed read-only source verification over the existing governed RDP route."""
import base64
import datetime as dt
import fcntl
import importlib.util
import json
from pathlib import Path
import secrets

spec=importlib.util.spec_from_file_location('files',Path(__file__).with_name('rdp-server-files.py'))
files=importlib.util.module_from_spec(spec)
spec.loader.exec_module(files)
require=files.rdp.require


def command(source,root,nonce,max_bytes):
    source,selected=files.rdp.select_root(source,[root])
    data=base64.b64encode(json.dumps({'source':source,'root':selected,'nonce':nonce,'maxBytes':max_bytes}).encode()).decode()
    script="$ErrorActionPreference='Stop';$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+data+"'))|ConvertFrom-Json;"
    script+=r"""
$r=@{ok=$true;source=$d.source;state='unavailable'};try{
$p=[IO.Path]::GetFullPath($d.source);$b=$d.root.TrimEnd('\');if($p-ne$b-and!$p.StartsWith($b+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Scope'};
$v=Get-PSDrive -Name $p.Substring(0,1);if($v.DisplayRoot-like '\\tsclient\*'){throw 'Redirected'};
$q='HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services';if((Get-ItemProperty -LiteralPath $q -Name fDisableCdm -ErrorAction SilentlyContinue).fDisableCdm-eq1){throw 'Policy'};
$e=@(Get-CimInstance -Namespace root/cimv2/TerminalServices -ClassName Win32_TSClientSetting -Filter "TerminalName='RDP-Tcp'");if($e.Count-ne1-or$null-eq$e[0].DriveMapping-or$e[0].DriveMapping-ne0){throw 'Policy'};
$c=[IO.Path]::GetDirectoryName($p);while($c){$i=Get-Item -Force -LiteralPath $c;if($i.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'Reparse'};$c=[IO.Path]::GetDirectoryName($c)};
try{$i=Get-Item -Force -LiteralPath $p}catch{if($_.CategoryInfo.Category-eq'ObjectNotFound'){$r.state='missing'};throw};
if($i.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'Reparse'};if($i.PSIsContainer){throw 'Type'};
if($i.Length-gt$d.maxBytes){$r.state='oversized';$r.bytes=$i.Length;$r.modifiedUtc=$i.LastWriteTimeUtc.ToString('o')}else{
$s=$null;$h=$null;try{$s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);if($s.Length-gt$d.maxBytes){throw 'Size'};$h=[Security.Cryptography.SHA256]::Create();$r.sha256=([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLower();$r.bytes=$s.Length;$r.modifiedUtc=$i.LastWriteTimeUtc.ToString('o');$r.state='present'}finally{if($h){$h.Dispose()};if($s){$s.Dispose()}}}
}catch{if($_.Exception.Message-eq'Policy'){$r.state='policy-denied'}elseif($_.Exception.Message-eq'Reparse'-or$_.CategoryInfo.Category-eq'PermissionDenied'-or$_.Exception-is[UnauthorizedAccessException]-or$_.Exception.InnerException-is[UnauthorizedAccessException]){$r.state='denied'}};
$r.nonce=$d.nonce;Set-Clipboard -Value ($r|ConvertTo-Json -Compress)
"""
    result='powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+base64.b64encode(script.encode('utf-16le')).decode()
    require(len(result)<=7800,'SOURCE_CHECK_COMMAND_TOO_LARGE')
    return result


def check(manifest,source):
    files.rdp.select_root(source,manifest['sourceRoots'])
    config,credentials,access,destination=files.rdp.load_config(manifest['connectionConfig'],manifest['accessManifest'])
    source,root=files.rdp.select_root(source,access['readRoots'])
    nonce=secrets.token_hex(16)
    program=command(source,root,nonce,manifest['maxFileBytes'])
    with (destination/'.operator.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        job=destination/(dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-')+nonce[:12])
        job.mkdir(mode=0o700)
        with files.rdp.RdpSession(config,credentials,access['target'],job) as session:
            result=session.execute(program,nonce,timeout=60)
        require(result.get('ok') is True and result.get('source')==source,'INVALID_SOURCE_CHECK')
        result['recordedAt']=files.sync.now()
        files.sync.atomic_json(job/'receipt.json',result)
        require(result.get('state')!='policy-denied','RDP_DRIVE_REDIRECTION_DISABLED')
        return result
