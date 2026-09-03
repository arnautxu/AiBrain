#!/usr/bin/env python3
"""Root-only operator inventory and copy-out over an existing, pinned RDP route."""
import argparse
import base64
import contextlib
import datetime
import fcntl
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import secrets
import select
import signal
import stat
import subprocess
import sys
import tempfile
import time

ALLOWED = {"inventory", "read", "copy-to-aibrain"}
DENIED = {"create", "write", "append", "overwrite", "delete", "move", "rename",
          "change-permissions", "execute-arbitrary-command"}
CONFIG_KEYS = {"AIBRAIN_RDP_HOST", "AIBRAIN_RDP_CREDENTIAL_FILE", "AIBRAIN_RDP_POLICY_FILE"} | {
    f"AIBRAIN_RDP_{target}_{field}" for target in ("TS", "DB")
    for field in ("PORT", "SERVER_NAME", "CERT_SHA256")}
CREDENTIAL_KEYS = {"AIBRAIN_RDP_USERNAME", "AIBRAIN_RDP_DOMAIN", "AIBRAIN_RDP_PASSWORD"}
SENSITIVE = re.compile(r"(^|[._ -])(secrets?|credentials?|passwords?|passwd|tokens?|private.?key)([._ -]|$)", re.I)
DEVICE_NAME = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.I)
COPY_EXTENSIONS = {".txt", ".csv", ".json", ".md", ".pdf", ".xlsx", ".xls", ".doc", ".rtf", ".docx", ".png", ".jpg", ".jpeg", ".bmp"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def private_file(path):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
            and not (info.st_mode & 0o077), "Configuration must be a private, regular root-owned file")
    require(path.resolve() == path.absolute(), "Configuration cannot resolve through symlinks")
    return path


def read_env(path, keys):
    values = {}
    for line in private_file(path).read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(separator and key in keys and key not in values and value,
                "Invalid or repeated configuration entry")
        values[key] = value
    require(set(values) == keys, "Missing configuration entries")
    return values


def windows_path(value):
    require(isinstance(value, str) and len(value) <= 512, "Invalid source path")
    require(re.match(r"^[a-zA-Z]:\\", value) is not None and "/" not in value,
            "Only explicit Windows drive paths are supported")
    require(not any(ord(c) < 32 for c in value) and not any(c in value[2:] for c in ':*?<>|"'),
            "Wildcards, streams and control characters are forbidden")
    parts = value[3:].rstrip("\\").split("\\") if value[3:].rstrip("\\") else []
    require(all(p and p not in (".", "..") and not p.startswith(".")
                and not p.endswith((".", " ")) and not SENSITIVE.search(p)
                and not DEVICE_NAME.match(p) for p in parts),
            "Unsafe or sensitive source path")
    return ntpath.normpath(value)


def select_root(source, roots):
    source = windows_path(source)
    for root in roots:
        root = windows_path(root)
        if ntpath.normcase(source) == ntpath.normcase(root) or ntpath.normcase(source).startswith(
                ntpath.normcase(root).rstrip("\\") + "\\"):
            return source, root
    raise ValueError("Source is outside the authorized roots")


def load_config(config_path, access_path):
    config = read_env(config_path, CONFIG_KEYS)
    credentials = read_env(config["AIBRAIN_RDP_CREDENTIAL_FILE"], CREDENTIAL_KEYS)
    policy = json.loads(private_file(config["AIBRAIN_RDP_POLICY_FILE"]).read_text())
    require(policy.get("schemaVersion") == 1 and policy.get("mode") == "read-only-export",
            "Read-only export policy required")
    remote, local = policy["remoteServer"], policy["aibrainServer"]
    require(set(remote["allowedOperations"]) == ALLOWED and set(remote["deniedOperations"]) == DENIED,
            "Unexpected remote operations in policy")
    require(local["overwriteExisting"] is False and local["requireSha256"] is True
            and local["recordSourcePath"] is True and local["preserveRemoteSource"] is True,
            "Export safeguards are required")
    destination = Path(local["copyDestinationRoot"])
    info = destination.lstat()
    require(re.fullmatch(r"/var/lib/aibrain/rdp-imports/[a-z0-9][a-z0-9-]{0,62}", str(destination))
            and destination.resolve() == destination and stat.S_ISDIR(info.st_mode)
            and info.st_uid == 0 and not info.st_mode & 0o022, "Unsafe export destination")
    access = json.loads(private_file(access_path).read_text())
    require(set(access) == {"schemaVersion", "target", "inventoryRoots", "readRoots", "maxFileBytes", "maxEntries"}
            and access["schemaVersion"] == 1 and access["target"] in ("ts", "db"), "Invalid access manifest")
    for field in ("inventoryRoots", "readRoots"):
        require(isinstance(access[field], list) and 0 < len(access[field]) <= 32, "Explicit roots required")
        for root in access[field]:
            windows_path(root)
    require(type(access["maxFileBytes"]) is int and 0 < access["maxFileBytes"] <= 16 * 1024 * 1024
            and type(access["maxEntries"]) is int and 0 < access["maxEntries"] <= 500, "Invalid access limits")
    require(re.fullmatch(r"[A-Za-z0-9.-]{1,253}", config["AIBRAIN_RDP_HOST"]), "Invalid host")
    for target in ("TS", "DB"):
        prefix = f"AIBRAIN_RDP_{target}_"
        require(config[prefix + "PORT"].isdigit() and 0 < int(config[prefix + "PORT"]) <= 65535
                and re.fullmatch(r"[A-Za-z0-9.-]{1,253}", config[prefix + "SERVER_NAME"])
                and re.fullmatch(r"[a-fA-F0-9]{64}", config[prefix + "CERT_SHA256"]), "Invalid pinned endpoint")
    require(re.fullmatch(r"[A-Za-z0-9._-]{1,128}", credentials["AIBRAIN_RDP_USERNAME"])
            and re.fullmatch(r"[A-Za-z0-9.-]{1,128}", credentials["AIBRAIN_RDP_DOMAIN"]), "Invalid account")
    return config, credentials, access, destination


def build_command(operation, source, root, nonce, access):
    require(operation in ("list", "copy"), "Unsupported operation")
    request = {"path": source, "root": root, "nonce": nonce, "limit": access["maxEntries"],
               "maxBytes": access["maxFileBytes"]}
    data = base64.b64encode(json.dumps(request).encode()).decode()
    # All source paths are data, never interpolated into PowerShell code.
    script = ("$ErrorActionPreference='Stop';$r=@{};try{"
              "$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + data + "'))|ConvertFrom-Json;"
              "$p=[IO.Path]::GetFullPath($d.path);$b=[IO.Path]::GetFullPath($d.root).TrimEnd('\\');"
              "$v=Get-PSDrive -Name $p.Substring(0,1);if($v.DisplayRoot-like '\\\\tsclient\\*'){throw 'Redirected drive rejected'};"
              "if($p-ne$b-and!$p.StartsWith($b+'\\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path rejected'};"
              "$c=$p;while($c){$i=Get-Item -Force -LiteralPath $c;"
              "if($i.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'Reparse point rejected'};"
              "$c=[IO.Path]::GetDirectoryName($c)};"
              "$i=Get-Item -Force -LiteralPath $p;")
    if operation == "list":
        script += ("if(!$i.PSIsContainer){throw 'Directory required'};"
                   "$e=@(Get-ChildItem -Force -LiteralPath $p|Select-Object -First ($d.limit+1));"
                   "$r=@{source=$p;truncated=($e.Count-gt$d.limit);"
                   "entries=@($e|Select-Object -First $d.limit|ForEach-Object{"
                   "@{name=$_.Name;directory=$_.PSIsContainer;bytes=$(if($_.PSIsContainer){$null}else{$_.Length});modifiedUtc=$_.LastWriteTimeUtc.ToString('o')}});"
                   r"exportDriveAvailable=(Test-Path -LiteralPath '\\tsclient\AiBrain')}")
    else:
        # Group Policy can explicitly allow redirection while the listener's
        # stored fDisableCdm remains 1. Query Windows' effective setting rather
        # than treating that overridden listener value as a separate veto.
        script += (
                   r"$q='HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services';"
                   "if((Get-ItemProperty -LiteralPath $q -Name fDisableCdm -ErrorAction SilentlyContinue).fDisableCdm-eq1)"
                   "{throw 'RDP_DRIVE_REDIRECTION_DISABLED'};"
                   "$e=@(Get-CimInstance -Namespace root/cimv2/TerminalServices -ClassName Win32_TSClientSetting "
                   "-Filter \"TerminalName='RDP-Tcp'\");"
                   "if($e.Count-ne1-or$null-eq$e[0].DriveMapping){throw 'RDP_POLICY_UNAVAILABLE'};"
                   "if($e[0].DriveMapping-eq1)"
                   "{throw 'RDP_DRIVE_REDIRECTION_DISABLED'};"
                   "if($e[0].DriveMapping-ne0){throw 'RDP_POLICY_UNAVAILABLE'};"
                   "$until=[DateTime]::UtcNow.AddSeconds(20);"
                   r"while(!(Test-Path -LiteralPath '\\tsclient\AiBrain')){"
                   "if([DateTime]::UtcNow-ge$until){throw 'RDP_EXPORT_DRIVE_UNAVAILABLE'};Start-Sleep -Milliseconds 500};"
                   "if($i.PSIsContainer-or$i.Length-gt$d.maxBytes){throw 'File exceeds export policy'};"
                   "$s=$null;$t=$null;try{"
                   "$s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);"
                   "if($s.Length-gt$d.maxBytes){throw 'File exceeds export policy'};"
                   "$h=[Security.Cryptography.SHA256]::Create();"
                   "$sha=([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLower();$h.Dispose();$s.Position=0;"
                   r"$t=[IO.File]::Open('\\tsclient\AiBrain\payload',[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);"
                   "$s.CopyTo($t);$t.Flush();"
                   "$r=@{source=$p;bytes=$s.Length;sha256=$sha;modifiedUtc=$i.LastWriteTimeUtc.ToString('o');"
                   "driveMapping=$e[0].DriveMapping;driveMappingPolicySource=$e[0].PolicySourceDriveMapping}"
                   "}finally{if($t){$t.Dispose()};if($s){$s.Dispose()}}")
    script += (";$r.ok=$true}catch{$r=@{ok=$false;error=$_.Exception.Message}};"
               "$r.nonce='" + nonce + "';$j=$r|ConvertTo-Json -Depth 6 -Compress;$j;Set-Clipboard -Value $j")
    encoded = base64.b64encode(script.encode("utf-16le")).decode()
    command = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + encoded
    require(len(command) <= 7800, "Request exceeds the console command limit")
    return command


class RdpSession:
    def __init__(self, config, credentials, target, destination):
        self.config, self.credentials, self.target, self.destination = config, credentials, target, destination
        self.processes = []
        self.console_open = False

    def run(self, args, timeout=8, **kwargs):
        return subprocess.run(args, env=self.env, capture_output=True, timeout=timeout, **kwargs)

    def key(self, key):
        self.run(["xdotool", "key", "--clearmodifiers", key], check=True)

    def type_text(self, text):
        raw = text.encode("ascii")
        fd = os.open(self.pipe, os.O_WRONLY | os.O_NONBLOCK)
        try:
            offset, deadline = 0, time.monotonic() + 5
            while offset < len(raw):
                require(time.monotonic() < deadline, "Keyboard pipe timeout")
                if select.select([], [fd], [], 0.2)[1]:
                    offset += os.write(fd, raw[offset:])
        finally:
            os.close(fd)
        # FreeRDP 3.30 emits press/release with a fixed 10 ms per character.
        time.sleep(len(raw) * 0.010 + 0.5)

    def __enter__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aibrain-rdp-access-")
        self.work = Path(self.temp.name)
        self.env = dict(os.environ)
        self.pipe = self.work / "keyboard.pipe"
        auth = self.work / "Xauthority"
        auth.touch(mode=0o600)
        cookie = secrets.token_hex(16)
        try:
            self.run(["xauth", "-f", str(auth), "add", ":99", "MIT-MAGIC-COOKIE-1", cookie], check=True)
            xvfb = subprocess.Popen(["Xvfb", "-displayfd", "1", "-screen", "0", "1280x800x24",
                                     "-nolisten", "tcp", "-auth", str(auth)], stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.processes.append(xvfb)
            require(select.select([xvfb.stdout], [], [], 10)[0], "Display startup timeout")
            display = ":" + xvfb.stdout.readline().decode().strip()
            xvfb.stdout.close()
            self.run(["xauth", "-f", str(auth), "add", display, "MIT-MAGIC-COOKIE-1", cookie], check=True)
            self.env.update(DISPLAY=display, XAUTHORITY=str(auth))
            p = "AIBRAIN_RDP_" + self.target.upper() + "_"
            args = ["/v:" + self.config["AIBRAIN_RDP_HOST"] + ":" + self.config[p + "PORT"],
                    "/server-name:" + self.config[p + "SERVER_NAME"],
                    "/u:" + self.credentials["AIBRAIN_RDP_USERNAME"], "/d:" + self.credentials["AIBRAIN_RDP_DOMAIN"],
                    "/p:" + self.credentials["AIBRAIN_RDP_PASSWORD"], "/sec:nla",
                    "/cert:fingerprint:sha256:" + self.config[p + "CERT_SHA256"].lower(),
                    "/size:1280x800", "/kbd:pipe:" + str(self.pipe),
                    # RDPDR's preferred DOS device name is limited to eight bytes.
                    "/clipboard:direction-to:all,files-to:off", "/drive:AiBrain," + str(self.destination),
                    "/log-level:ERROR"]
            argsfile = self.work / "connection.args"
            with open(argsfile, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as f:
                f.write("\n".join(args) + "\n")
            rdp = subprocess.Popen(["xfreerdp3", "/args-from:file:" + str(argsfile)], env=self.env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.rdp = rdp
            self.processes.append(rdp)
            deadline = time.monotonic() + 35
            while not self.pipe.exists():
                require(rdp.poll() is None and time.monotonic() < deadline, "RDP session startup failed")
                time.sleep(0.25)
            argsfile.unlink()
            time.sleep(8)
            windows = self.run(["xdotool", "search", "--onlyvisible", "--pid", str(rdp.pid)], check=True).stdout.splitlines()
            require(windows, "RDP window unavailable")
            self.run(["xdotool", "windowfocus", windows[-1].decode()], check=True)
            self.key("Escape")
            self.key("Escape")
            self.key("super+r")
            time.sleep(0.7)
            self.key("ctrl+a")
            self.type_text("cmd /d")
            self.key("Return")
            time.sleep(1.5)
            self.console_open = True
            return self
        except BaseException:
            self.__exit__(*sys.exc_info())
            raise

    def execute(self, command, nonce, timeout=30):
        # Paste fixed generated commands as text; simulating thousands of Shift
        # presses can trigger Windows Sticky Keys and race console input.
        publisher = subprocess.Popen(["xclip", "-selection", "clipboard", "-in", "-quiet"],
                                     env=self.env, stdin=subprocess.PIPE,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(publisher)
        publisher.stdin.write(command.encode("ascii"))
        publisher.stdin.close()
        time.sleep(0.7)
        self.key("ctrl+v")
        time.sleep(1)
        self.key("Return")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            require(self.rdp.poll() is None, "RDP_CONNECTION_LOST")
            clipboard = self.run(["xclip", "-selection", "clipboard", "-o"], timeout=5)
            try:
                result = json.loads(clipboard.stdout)
            except (ValueError, UnicodeError):
                result = None
            if isinstance(result, dict) and result.get("nonce") == nonce:
                return result
            time.sleep(0.5)
        raise ValueError("No matching RDP readback; source access was not confirmed")

    def __exit__(self, error_type, *_):
        if self.console_open and error_type is None:
            with contextlib.suppress(Exception):
                self.run(["xdotool", "type", "--clearmodifiers", "exit"], check=True)
                self.key("Return")
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        self.temp.cleanup()


def validate_copy(job, result, source, max_bytes):
    require(result.get("ok") is True and ntpath.normcase(result.get("source", "")) == ntpath.normcase(source),
            "Export receipt does not match the requested source")
    payload = job / "payload"
    info = payload.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= max_bytes
            and type(result.get("bytes")) is int and info.st_size == result["bytes"], "Export size or type mismatch")
    digest = hashlib.sha256(payload.read_bytes()).hexdigest()
    require(digest == result.get("sha256"), "Windows and Hetzner hashes do not match")
    payload.chmod(0o600)
    files = job / "files"
    files.mkdir(mode=0o700)
    destination = files / ntpath.basename(source)
    require(not destination.exists(), "Existing export cannot be overwritten")
    os.link(payload, destination)
    payload.unlink()
    return {**result, "destination": str(destination), "verifiedSha256": digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["list", "copy"])
    parser.add_argument("--path", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--access", required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0, "Run as the host operator (root)")
    def timeout_handler(*_):
        raise TimeoutError("RDP operation exceeded its 180 second deadline")
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    signal.alarm(180)
    os.umask(0o077)
    config, credentials, access, destination = load_config(args.config, args.access)
    source, root = select_root(args.path, access["inventoryRoots" if args.operation == "list" else "readRoots"])
    if args.operation == "copy":
        require(ntpath.splitext(source)[1].lower() in COPY_EXTENSIONS, "File format is not authorized for export")
    nonce = secrets.token_hex(16)
    command = build_command(args.operation, source, root, nonce, access)
    with (destination / ".operator.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        job = destination / (datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + nonce[:12])
        job.mkdir(mode=0o700)
        try:
            with RdpSession(config, credentials, access["target"], job) as session:
                result = session.execute(command, nonce, timeout=120 if args.operation == "copy" else 30)
            require(result.get("ok") is True, "Windows readback rejected the request: " + str(result.get("error", "unknown")))
            if args.operation == "copy":
                result = validate_copy(job, result, source, access["maxFileBytes"])
            result.update(operation=args.operation, target=access["target"], transport="rdp",
                          recordedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          toolSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
            with (job / "receipt.json").open("x") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print(json.dumps({**result, "receipt": str(job / "receipt.json")}, ensure_ascii=False))
        except BaseException as error:
            # Only this invocation's new export is eligible for failed-copy cleanup.
            for child in job.iterdir():
                if child.name == "payload" and child.is_file() and not child.is_symlink():
                    child.unlink()
            failure = {"ok": False, "operation": args.operation, "source": source,
                       "target": access["target"], "nonce": nonce,
                       "error": str(error) if isinstance(error, ValueError) else type(error).__name__,
                       "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            with (job / "failure.json").open("x") as f:
                json.dump(failure, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print("Failure receipt: " + str(job / "failure.json"), file=sys.stderr)
            raise


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print("AIBRAIN_RDP_ACCESS_FAILED: " + str(error), file=sys.stderr)
        sys.exit(1)
