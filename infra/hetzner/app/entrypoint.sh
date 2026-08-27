#!/bin/sh
set -eu

umask 077

fail() {
  echo "AiBrain container preflight failed: $1" >&2
  exit 78
}

require_value() {
  variable_name=$1
  variable_value=$(printenv "$variable_name" 2>/dev/null || true)
  [ -n "$variable_value" ] || fail "$variable_name is required"
  case "$variable_value" in
    replace-*|*replace_me*|000.0.0000.0) fail "$variable_name still contains an example value" ;;
  esac
}

require_secret() {
  variable_name=$1
  require_value "$variable_name"
  variable_value=$(printenv "$variable_name")
  byte_length=$(printf %s "$variable_value" | wc -c | tr -d ' ')
  [ "$byte_length" -ge 32 ] || fail "$variable_name must contain at least 32 bytes"
}

[ "$(id -u)" -ne 0 ] || fail "the application must not run as root"
[ "${NODE_ENV:-}" = production ] || fail "NODE_ENV must be production"
[ "${AIBRAIN_AUTH_MODE:-}" = supabase ] || fail "AIBRAIN_AUTH_MODE must be supabase"
[ "${CHAT_RUNTIME:-}" = codex ] || fail "CHAT_RUNTIME must be codex"
[ "${CODEX_BIN:-}" = /usr/local/bin/aibrain-codex-worker ] || fail "CODEX_BIN must use the worker filesystem sandbox"
[ "${AIBRAIN_SOFFICE_BIN:-}" = /usr/local/bin/aibrain-soffice ] || fail "LibreOffice must use the safe headless wrapper"

require_secret AIBRAIN_SESSION_SECRET
require_secret AIBRAIN_AUTH_CHALLENGE_SECRET
require_secret AIBRAIN_PUBLICATION_SECRET
require_secret AIBRAIN_BROWSER_GATEWAY_SECRET
require_value NEXT_PUBLIC_SUPABASE_URL
require_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
require_value AIBRAIN_CHROME_EXPECTED_VERSION

node -e '
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    process.exit(64);
  }
' || fail "NEXT_PUBLIC_SUPABASE_URL must be a credential-free HTTPS origin"

printf %s "$AIBRAIN_CHROME_EXPECTED_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' \
  || fail "AIBRAIN_CHROME_EXPECTED_VERSION must be an exact four-part version"

config_path=${AIBRAIN_INSTALLATION_CONFIG:-/etc/aibrain/installation.json}
[ "$config_path" = /etc/aibrain/installation.json ] || fail "installation config must use the immutable container path"
[ -f "$config_path" ] && [ ! -L "$config_path" ] || fail "installation config must be a regular non-symlink file"

node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expected = {
    dataRoot: "/var/lib/aibrain/data",
    companyContextRoot: "/var/lib/aibrain/data/company-context",
    usersRoot: "/var/lib/aibrain/data/users",
    sourceReadRoot: "/srv/aibrain/source-ro",
    publishWriteRoot: "/srv/aibrain/publish-rw",
    backupsRoot: "/var/lib/aibrain/data/backups",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (config?.paths?.[key] !== value) {
      throw new Error(`installation paths.${key} must be ${value} inside the container`);
    }
  }
' "$config_path" || fail "installation config does not match the container mount contract"

[ -d /var/lib/aibrain/data ] && [ -w /var/lib/aibrain/data ] || fail "data volume is not writable by the application user"
[ -d /var/lib/aibrain/data/backups ] && [ -w /var/lib/aibrain/data/backups ] || fail "backup volume is not writable by the application user"
[ -d /var/lib/aibrain-restores ] && [ -w /var/lib/aibrain-restores ] || fail "restore validation volume is not writable by the application user"
[ -d /srv/aibrain/source-ro ] && [ ! -w /srv/aibrain/source-ro ] || fail "source-ro is missing or writable"
[ -d /srv/aibrain/publish-rw ] && [ -w /srv/aibrain/publish-rw ] || fail "publish-rw is missing or not writable by the server publisher"

for private_directory in \
  /var/lib/aibrain/data/app-home \
  /var/lib/aibrain/data/company-context \
  /var/lib/aibrain/data/users \
  /var/lib/aibrain/data/server/xdg/cache \
  /var/lib/aibrain/data/server/xdg/config \
  /var/lib/aibrain/data/server/xdg/data \
  /var/lib/aibrain/data/server/xdg/state; do
  mkdir -p "$private_directory"
  chmod 0700 "$private_directory"
done

for executable in \
  /usr/local/bin/codex-real \
  /usr/local/bin/aibrain-codex-worker \
  /usr/local/bin/aibrain-soffice \
  /usr/local/bin/aibrain-backup \
  /usr/bin/bwrap \
  /usr/bin/chromium \
  /usr/bin/pdfinfo \
  /usr/bin/pdftoppm \
  /usr/bin/qpdf; do
  [ -x "$executable" ] || fail "required executable is unavailable: $executable"
done

actual_chrome_version=$(/usr/bin/chromium --version | sed -n 's/^[^0-9]*\([0-9][0-9.]*\).*$/\1/p')
[ "$actual_chrome_version" = "$AIBRAIN_CHROME_EXPECTED_VERSION" ] || fail "Chromium does not match AIBRAIN_CHROME_EXPECTED_VERSION"

# Fail closed when the host cannot create the worker mount namespace, hide the
# product data root, selectively re-expose an approved read root, or mask the
# official publisher root. There is deliberately no unsandboxed fallback.
boundary_marker=$(mktemp /srv/aibrain/publish-rw/.aibrain-boundary.XXXXXX)
hidden_marker=$(mktemp /var/lib/aibrain/data/.aibrain-hidden.XXXXXX)
allowed_marker=$(mktemp /var/lib/aibrain/data/company-context/.aibrain-allowed.XXXXXX)
trap 'rm -f "$boundary_marker" "$hidden_marker" "$allowed_marker"' EXIT INT TERM
/usr/bin/bwrap \
  --ro-bind / / \
  --dev /dev \
  --proc /proc \
  --unshare-pid \
  --unshare-ipc \
  --tmpfs /var/lib/aibrain/data \
  --ro-bind /var/lib/aibrain/data/company-context /var/lib/aibrain/data/company-context \
  --tmpfs /srv/aibrain/publish-rw \
  --remount-ro /srv/aibrain/publish-rw \
  /bin/sh -c '[ ! -e "$1" ] && [ -f "$2" ] && ! : >"$2" && [ ! -e "$3" ] && ! : >"$4"' sh \
    "$hidden_marker" "$allowed_marker" \
    "$boundary_marker" /srv/aibrain/publish-rw/worker-write-test \
  >/dev/null 2>&1 || fail "bubblewrap worker isolation is unavailable on this host"
rm -f "$boundary_marker" "$hidden_marker" "$allowed_marker"
trap - EXIT INT TERM

exec "$@"
