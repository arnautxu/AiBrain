#!/usr/bin/env bash

set -euo pipefail

readonly FREERDP_BIN="/usr/bin/xfreerdp3"
readonly TIMEOUT_BIN="/usr/bin/timeout"
readonly JQ_BIN="/usr/bin/jq"
readonly AUTH_TIMEOUT_SECONDS=30

declare -A config=()
declare -A credentials=()
config_file=""
target="all"
temp_dir=""
args_file=""
log_file=""
password=""

fail() {
  printf 'AIBRAIN_RDP_FAILED: %s\n' "$1" >&2
  exit 1
}

usage() {
  printf 'Usage: sudo %s --config <absolute-path> [--target ts|db|all]\n' "$0" >&2
  exit 64
}

cleanup() {
  local status="$?"
  password=""
  if [[ -n "${args_file:-}" && "$args_file" == /tmp/aibrain-rdp-auth.*/connection.args ]]; then
    rm -f -- "$args_file"
  fi
  if [[ -n "${log_file:-}" && "$log_file" == /tmp/aibrain-rdp-auth.*/freerdp.log ]]; then
    rm -f -- "$log_file"
  fi
  if [[ -n "${temp_dir:-}" && "$temp_dir" == /tmp/aibrain-rdp-auth.* && -d "$temp_dir" && ! -L "$temp_dir" ]]; then
    rmdir -- "$temp_dir" 2>/dev/null || true
  fi
  exit "$status"
}

trap cleanup EXIT

while (($# > 0)); do
  case "$1" in
    --config)
      (($# >= 2)) || usage
      config_file="$2"
      shift 2
      ;;
    --target)
      (($# >= 2)) || usage
      target="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

[[ "$EUID" == "0" ]] || fail "the verifier must run as root"
[[ "$config_file" == /* ]] || fail "--config must be an absolute path"
[[ "$target" == "ts" || "$target" == "db" || "$target" == "all" ]] || fail "--target must be ts, db or all"

for binary in "$FREERDP_BIN" "$TIMEOUT_BIN" "$JQ_BIN" /usr/bin/stat /usr/bin/mktemp; do
  [[ -x "$binary" ]] || fail "required binary is unavailable: ${binary}"
done

require_root_file() {
  local file="$1" label="$2" metadata owner mode links
  [[ -f "$file" && ! -L "$file" ]] || fail "${label} must be a regular non-symlink file"
  metadata="$(/usr/bin/stat -c '%u %a %h' "$file")" || fail "cannot inspect ${label}"
  read -r owner mode links <<<"$metadata"
  [[ "$owner" == "0" ]] || fail "${label} must be root-owned"
  [[ "$links" == "1" ]] || fail "${label} must have exactly one hard link"
  (( (8#$mode & 8#077) == 0 )) || fail "${label} must not be accessible by group or world"
}

is_allowed_config_key() {
  case "$1" in
    AIBRAIN_RDP_HOST|AIBRAIN_RDP_CREDENTIAL_FILE|AIBRAIN_RDP_POLICY_FILE|\
    AIBRAIN_RDP_TS_PORT|AIBRAIN_RDP_TS_SERVER_NAME|AIBRAIN_RDP_TS_CERT_SHA256|\
    AIBRAIN_RDP_DB_PORT|AIBRAIN_RDP_DB_SERVER_NAME|AIBRAIN_RDP_DB_CERT_SHA256) return 0 ;;
    *) return 1 ;;
  esac
}

read_strict_env() {
  local file="$1" destination="$2" line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || fail "${destination} contains a malformed line"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ && -n "$value" ]] || fail "${destination} contains an invalid key or empty value"
    if [[ "$destination" == "config" ]]; then
      is_allowed_config_key "$key" || fail "config contains an unknown key: ${key}"
      [[ ! ${config[$key]+present} ]] || fail "config repeats key: ${key}"
      config["$key"]="$value"
    else
      [[ "$key" == "AIBRAIN_RDP_USERNAME" || "$key" == "AIBRAIN_RDP_DOMAIN" || "$key" == "AIBRAIN_RDP_PASSWORD" ]] \
        || fail "credentials contain an unknown key"
      [[ ! ${credentials[$key]+present} ]] || fail "credentials repeat a key"
      credentials["$key"]="$value"
    fi
  done <"$file"
}

required_value() {
  local collection="$1" key="$2"
  if [[ "$collection" == "config" ]]; then
    [[ ${config[$key]+present} ]] || fail "config is missing ${key}"
    printf '%s' "${config[$key]}"
  else
    [[ ${credentials[$key]+present} ]] || fail "credentials are missing ${key}"
    printf '%s' "${credentials[$key]}"
  fi
}

require_root_file "$config_file" "RDP config"
read_strict_env "$config_file" config

credential_file="$(required_value config AIBRAIN_RDP_CREDENTIAL_FILE)"
policy_file="$(required_value config AIBRAIN_RDP_POLICY_FILE)"
[[ "$credential_file" == /* && "$policy_file" == /* ]] || fail "credential and policy paths must be absolute"
require_root_file "$credential_file" "RDP credentials"
require_root_file "$policy_file" "RDP policy"
read_strict_env "$credential_file" credentials

username="$(required_value credentials AIBRAIN_RDP_USERNAME)"
domain="$(required_value credentials AIBRAIN_RDP_DOMAIN)"
password="$(required_value credentials AIBRAIN_RDP_PASSWORD)"
[[ "$username" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || fail "RDP username is invalid"
[[ "$domain" =~ ^[A-Za-z0-9.-]{1,128}$ ]] || fail "RDP domain is invalid"
[[ "$password" != *$'\n'* && "$password" != *$'\r'* ]] || fail "RDP password contains a line break"

copy_root="$($JQ_BIN -er '.aibrainServer.copyDestinationRoot' "$policy_file")" || fail "RDP policy is invalid"
$JQ_BIN -e '
  .schemaVersion == 1 and
  .mode == "read-only-export" and
  (.remoteServer.allowedOperations | sort) == (["copy-to-aibrain", "inventory", "read"] | sort) and
  (.remoteServer.deniedOperations | sort) == ([
    "append", "change-permissions", "create", "delete", "execute-arbitrary-command",
    "move", "overwrite", "rename", "write"
  ] | sort) and
  .aibrainServer.overwriteExisting == false and
  .aibrainServer.requireSha256 == true and
  .aibrainServer.recordSourcePath == true and
  .aibrainServer.preserveRemoteSource == true and
  (.aibrainServer.copyDestinationRoot | type) == "string" and
  (.aibrainServer.copyDestinationRoot | startswith("/"))
' "$policy_file" >/dev/null || fail "RDP policy does not enforce read-only export"
[[ -d "$copy_root" && ! -L "$copy_root" ]] || fail "copy destination root is unavailable"
[[ "$copy_root" =~ ^/var/lib/aibrain/rdp-imports/[a-z0-9][a-z0-9-]{0,62}$ ]] \
  || fail "copy destination root is outside the dedicated RDP import boundary"
copy_root_metadata="$(/usr/bin/stat -c '%u %a' "$copy_root")" || fail "cannot inspect copy destination root"
read -r copy_root_owner copy_root_mode <<<"$copy_root_metadata"
[[ "$copy_root_owner" == "0" ]] || fail "copy destination root must be root-owned"
(( (8#$copy_root_mode & 8#022) == 0 )) || fail "copy destination root must not be group/world writable"

host="$(required_value config AIBRAIN_RDP_HOST)"
[[ "$host" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || fail "RDP host is invalid"

validate_endpoint() {
  local endpoint="$1" prefix port server_name fingerprint
  prefix="AIBRAIN_RDP_${endpoint^^}"
  port="$(required_value config "${prefix}_PORT")"
  server_name="$(required_value config "${prefix}_SERVER_NAME")"
  fingerprint="$(required_value config "${prefix}_CERT_SHA256")"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || fail "${endpoint} port is invalid"
  ((port >= 1 && port <= 65535)) || fail "${endpoint} port is outside the TCP range"
  [[ "$server_name" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || fail "${endpoint} server name is invalid"
  [[ "$fingerprint" =~ ^[A-Fa-f0-9]{64}$ ]] || fail "${endpoint} certificate fingerprint must be SHA-256"
}

validate_endpoint ts
validate_endpoint db

verify_endpoint() {
  local endpoint="$1" prefix port server_name fingerprint status
  prefix="AIBRAIN_RDP_${endpoint^^}"
  port="${config[${prefix}_PORT]}"
  server_name="${config[${prefix}_SERVER_NAME]}"
  fingerprint="${config[${prefix}_CERT_SHA256],,}"
  temp_dir="$(/usr/bin/mktemp -d /tmp/aibrain-rdp-auth.XXXXXX)"
  chmod 0700 "$temp_dir"
  args_file="$temp_dir/connection.args"
  log_file="$temp_dir/freerdp.log"
  umask 077
  printf '%s\n' \
    "/v:${host}:${port}" \
    "/server-name:${server_name}" \
    "/u:${username}" \
    "/d:${domain}" \
    "/p:${password}" \
    "/sec:nla" \
    "/cert:fingerprint:sha256:${fingerprint}" \
    "+auth-only" \
    "/log-level:ERROR" >"$args_file"
  set +e
  "$TIMEOUT_BIN" "$AUTH_TIMEOUT_SECONDS" "$FREERDP_BIN" "/args-from:file:${args_file}" >"$log_file" 2>&1
  status="$?"
  set -e
  rm -f -- "$args_file" "$log_file"
  rmdir -- "$temp_dir"
  args_file=""
  log_file=""
  temp_dir=""
  [[ "$status" == "0" ]] || fail "${endpoint} authentication failed with status ${status}"
  printf 'AIBRAIN_RDP_AUTH_OK target=%s host=%s port=%s server=%s policy=read-only-export\n' \
    "$endpoint" "$host" "$port" "$server_name"
}

if [[ "$target" == "all" ]]; then
  verify_endpoint ts
  verify_endpoint db
else
  verify_endpoint "$target"
fi
