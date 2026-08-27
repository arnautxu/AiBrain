#!/bin/sh
set -eu

profile_root=
has_headless=0
has_safe_mode=0
has_no_restore=0

for argument in "$@"; do
  case "$argument" in
    -env:UserInstallation=file://*) profile_root=${argument#-env:UserInstallation=file://} ;;
    --headless) has_headless=1 ;;
    --safe-mode) has_safe_mode=1 ;;
    --norestore) has_no_restore=1 ;;
  esac
done

[ "$has_headless" -eq 1 ] || { echo "LibreOffice refused: --headless is required" >&2; exit 78; }
[ "$has_safe_mode" -eq 1 ] || { echo "LibreOffice refused: --safe-mode is required" >&2; exit 78; }
[ "$has_no_restore" -eq 1 ] || { echo "LibreOffice refused: --norestore is required" >&2; exit 78; }

case "$profile_root" in
  /var/lib/aibrain/data/users/*/staging/*) ;;
  *) echo "LibreOffice refused: private staging profile is required" >&2; exit 78 ;;
esac

[ ! -L "$profile_root" ] || { echo "LibreOffice refused: profile may not be a symlink" >&2; exit 78; }
mkdir -p "$profile_root/user"
chmod 0700 "$profile_root" "$profile_root/user"

# Level 3 is LibreOffice's "Very High" macro policy. There are no trusted
# locations in this disposable profile, so document macros cannot execute.
cat >"$profile_root/user/registrymodifications.xcu" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
</oor:items>
EOF
chmod 0600 "$profile_root/user/registrymodifications.xcu"

exec /usr/bin/soffice "$@"
