#!/bin/sh
set -eu

fail() {
  echo "AiBrain worker sandbox refused to start: $1" >&2
  exit 78
}

[ "$(id -u)" -ne 0 ] || fail "workers must not run as root"
[ "$#" -ge 1 ] || fail "Codex App Server arguments are required"
[ "${1:-}" = app-server ] || fail "only codex app-server may use the worker launcher"

config_path=/etc/aibrain/installation.json
[ -f "$config_path" ] && [ ! -L "$config_path" ] || fail "installation config is unavailable"

publish_root=$(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const value = config?.paths?.publishWriteRoot;
  if (typeof value !== "string" || !path.isAbsolute(value) || value === "/") process.exit(64);
  process.stdout.write(path.resolve(value));
' "$config_path") || fail "publishWriteRoot is invalid"

workspace=$(pwd -P)
user_root=$(dirname "$workspace")
runtime_root=$user_root/runtime
staging_root=$user_root/staging
artifacts_root=$user_root/artifacts
transport_audit_root=$user_root/audit/transport

[ "$workspace" = "$user_root/workspace" ] || fail "working directory is not the provisioned employee workspace"
[ "${HOME:-}" = "$runtime_root/home" ] || fail "HOME is not bound to the provisioned employee"
[ "${CODEX_HOME:-}" = "$runtime_root/codex-home" ] || fail "CODEX_HOME is not bound to the provisioned employee"
[ "${XDG_CACHE_HOME:-}" = "$runtime_root/xdg/cache" ] || fail "XDG cache is not employee-private"
[ "${XDG_CONFIG_HOME:-}" = "$runtime_root/xdg/config" ] || fail "XDG config is not employee-private"
[ "${XDG_DATA_HOME:-}" = "$runtime_root/xdg/data" ] || fail "XDG data is not employee-private"
[ "${XDG_STATE_HOME:-}" = "$runtime_root/xdg/state" ] || fail "XDG state is not employee-private"
[ "${TMPDIR:-}" = "$staging_root/tmp" ] || fail "TMPDIR is not employee-private"

for writable_root in "$runtime_root" "$workspace" "$staging_root" "$artifacts_root" "$transport_audit_root"; do
  [ -d "$writable_root" ] && [ ! -L "$writable_root" ] || fail "unsafe worker root: $writable_root"
  canonical_root=$(realpath "$writable_root")
  [ "$canonical_root" = "$writable_root" ] || fail "worker roots may not resolve through symlinks"
done

[ -d "$publish_root" ] && [ ! -L "$publish_root" ] || fail "publish root is unavailable"
[ "$(realpath "$publish_root")" = "$publish_root" ] || fail "publish root may not resolve through symlinks"

# The container root is read-only. Only this employee's declared runtime roots
# are rebound read-write. publish-rw is replaced by an empty read-only mount,
# so Codex cannot read or mutate the official document repository.
exec /usr/bin/bwrap \
  --die-with-parent \
  --new-session \
  --unshare-pid \
  --unshare-ipc \
  --unshare-uts \
  --hostname aibrain-worker \
  --ro-bind / / \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --tmpfs /run \
  --tmpfs "$publish_root" \
  --remount-ro "$publish_root" \
  --bind "$runtime_root" "$runtime_root" \
  --bind "$workspace" "$workspace" \
  --bind "$staging_root" "$staging_root" \
  --bind "$artifacts_root" "$artifacts_root" \
  --bind "$transport_audit_root" "$transport_audit_root" \
  --chdir "$workspace" \
  /usr/local/bin/codex-real "$@"
