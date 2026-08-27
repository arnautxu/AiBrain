#!/bin/bash
set -euo pipefail

fail() {
  echo "AiBrain document tool refused to start: $1" >&2
  exit 78
}

launcher=$(basename "$0")
case "$launcher" in
  aibrain-soffice) tool=/usr/bin/soffice ;;
  aibrain-qpdf) tool=/usr/bin/qpdf ;;
  aibrain-pdfinfo) tool=/usr/bin/pdfinfo ;;
  aibrain-pdftoppm) tool=/usr/bin/pdftoppm ;;
  aibrain-pdftotext) tool=/usr/bin/pdftotext ;;
  *) fail "unknown launcher" ;;
esac

logical_work=$(pwd -L)
work_root=$(pwd -P)
[ "$logical_work" = "$work_root" ] || fail "work directory may not resolve through a symlink"
[ -d "$work_root" ] && [ ! -L "$work_root" ] || fail "work directory is unsafe"

uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}'
preview_pattern="^/var/lib/aibrain/data/users/${uuid}/state/document-previews/${uuid}/${uuid}/[.]work-[A-Za-z0-9_-]+$"
turn_pattern='^(/tmp|/private/tmp)/aibrain-turn-document-[A-Za-z0-9_-]+$'
[[ "$work_root" =~ $preview_pattern || "$work_root" =~ $turn_pattern ]] || fail "work directory is outside a private conversion root"

mkdir -p "$work_root/home" "$work_root/tmp"
chmod 0700 "$work_root" "$work_root/home" "$work_root/tmp"

preflight=${AIBRAIN_DOCUMENT_SANDBOX_PREFLIGHT:-}
if [ "$preflight" = entrypoint-boundary-v1 ]; then
  [ "$#" -eq 1 ] && [ "$1" = --aibrain-preflight ] || fail "preflight invocation is invalid"
  hidden=${AIBRAIN_DOCUMENT_PREFLIGHT_HIDDEN:-}
  publish_marker=${AIBRAIN_DOCUMENT_PREFLIGHT_PUBLISH:-}
  case "$hidden" in /var/lib/aibrain/data/.aibrain-document-hidden.*) ;; *) fail "hidden preflight marker is invalid" ;; esac
  case "$publish_marker" in /srv/aibrain/publish-rw/.aibrain-document-publish.*) ;; *) fail "publish preflight marker is invalid" ;; esac
  command=(/bin/sh -c '[ ! -e "$1" ] && [ ! -e "$2" ] && : > "/work/preflight-$3-ok" && ! : > "$2"' sh "$hidden" "$publish_marker" "$launcher")
else
  rewritten=()
  has_headless=0
  has_safe_mode=0
  has_no_restore=0
  has_profile=0
  for argument in "$@"; do
    case "$argument" in
      *../*|*/..|..) fail "parent traversal argument is forbidden" ;;
      --headless) has_headless=1 ;;
      --safe-mode) has_safe_mode=1 ;;
      --norestore) has_no_restore=1 ;;
      -env:UserInstallation=file://*)
        profile_root=${argument#-env:UserInstallation=file://}
        [ "$profile_root" = "$work_root/lo-profile" ] || fail "LibreOffice profile must be private to this conversion"
        argument='-env:UserInstallation=file:///work/lo-profile'
        has_profile=1
        ;;
      /*)
        if [ "$argument" = "$work_root" ]; then
          argument=/work
        elif [[ "$argument" == "$work_root/"* ]]; then
          argument="/work/${argument#"$work_root/"}"
        else
          fail "absolute argument escapes the private conversion root"
        fi
        ;;
    esac
    rewritten+=("$argument")
  done
  if [ "$launcher" = aibrain-soffice ]; then
    [ "$has_headless" -eq 1 ] || fail "LibreOffice requires --headless"
    [ "$has_safe_mode" -eq 1 ] || fail "LibreOffice requires --safe-mode"
    [ "$has_no_restore" -eq 1 ] || fail "LibreOffice requires --norestore"
    [ "$has_profile" -eq 1 ] || fail "LibreOffice requires its private profile"
    mkdir -p "$work_root/lo-profile/user"
    chmod 0700 "$work_root/lo-profile" "$work_root/lo-profile/user"
    cat >"$work_root/lo-profile/user/registrymodifications.xcu" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
</oor:items>
EOF
    chmod 0600 "$work_root/lo-profile/user/registrymodifications.xcu"
  fi
  command=("$tool" "${rewritten[@]}")
fi

exec /usr/bin/bwrap \
  --die-with-parent \
  --new-session \
  --unshare-pid \
  --unshare-ipc \
  --unshare-uts \
  --unshare-net \
  --hostname aibrain-document \
  --cap-drop ALL \
  --ro-bind / / \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --tmpfs /run \
  --tmpfs /etc/aibrain \
  --remount-ro /etc/aibrain \
  --tmpfs /var/lib/aibrain/data \
  --remount-ro /var/lib/aibrain/data \
  --tmpfs /srv/aibrain/source-ro \
  --remount-ro /srv/aibrain/source-ro \
  --tmpfs /srv/aibrain/publish-rw \
  --remount-ro /srv/aibrain/publish-rw \
  --dir /work \
  --bind "$work_root" /work \
  --chdir /work \
  --clearenv \
  --setenv HOME /work/home \
  --setenv TMPDIR /work/tmp \
  --setenv LANG C.UTF-8 \
  --setenv LC_ALL C.UTF-8 \
  --setenv SAL_USE_VCLPLUGIN svp \
  "${command[@]}"
