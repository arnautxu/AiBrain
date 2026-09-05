#!/usr/bin/env bash
set -euo pipefail

readonly INSTALLATION_ID="company-qa"
readonly COMPOSE_PROJECT="aibrain-company-qa"
readonly STATE_FILE="/etc/aibrain/company-qa/release-state.json"
readonly DEPLOY_LOCK="/opt/aibrain-company-qa/deploy.lock"
readonly CLEANUP_LOCK="/run/lock/aibrain-arnall-storage-cleanup.lock"
readonly STORAGE_ROOT="/opt/aibrain-company-qa"
readonly MIN_AGE_DAYS=7
readonly MAX_RUNTIME_SECONDS=300
readonly COMMAND_TIMEOUT_SECONDS=30
readonly APP_REPOSITORY="ghcr.io/arnautxu/aibrain"
readonly EGRESS_REPOSITORY="ghcr.io/arnautxu/aibrain-egress"
readonly LIVE_URL="https://arnall.graphikai.com/api/health/live"
readonly READY_URL="https://arnall.graphikai.com/api/health/ready"

mode="dry-run"
started_at_epoch=0
directory_bytes=0
image_bytes=0
directories_removed=0
images_removed=0
containers_removed=0

log() {
  printf '%s %s\n' "$(date --utc +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ARNALL_STORAGE_CLEANUP_FAILED reason=$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: aibrain-arnall-storage-cleanup [--dry-run|--execute]

The default is --dry-run. --execute removes only allowlisted, old Arnall
release staging directories and unused Arnall images outside current/previous.
EOF
}

parse_args() {
  (($# <= 1)) || { usage >&2; exit 64; }
  case "${1:---dry-run}" in
    --dry-run) mode="dry-run" ;;
    --execute) mode="execute" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing-command command=$1"
}

check_deadline() {
  local now
  now="$(date +%s)"
  ((now - started_at_epoch < MAX_RUNTIME_SECONDS)) || fail "runtime-budget-exhausted"
}

bounded() {
  timeout --signal=TERM --kill-after=5s "${COMMAND_TIMEOUT_SECONDS}s" "$@"
}

require_regular_root_file() {
  local target="$1" mode_bits
  [[ -f "$target" && ! -L "$target" ]] || fail "unsafe-required-file path=$target"
  [[ "$(stat -c '%u' "$target")" == "0" ]] || fail "non-root-required-file path=$target"
  mode_bits="$(stat -c '%a' "$target")"
  (( (8#$mode_bits & 8#022) == 0 )) || fail "writable-required-file path=$target"
}

acquire_locks_and_release_guard() {
  install -d -m 0755 -o root -g root "${CLEANUP_LOCK%/*}"
  exec 9>"$CLEANUP_LOCK"
  flock --exclusive --nonblock 9 || {
    log "ARNALL_STORAGE_CLEANUP_SKIPPED reason=cleanup-active"
    exit 75
  }

  require_regular_root_file "$DEPLOY_LOCK"
  exec 8<"$DEPLOY_LOCK"
  flock --shared --nonblock 8 || {
    log "ARNALL_STORAGE_CLEANUP_SKIPPED reason=deployment-active"
    exit 75
  }

  [[ ! -e "${STATE_FILE}.transaction.json" && ! -e "${STATE_FILE}.lock" ]] || {
    log "ARNALL_STORAGE_CLEANUP_SKIPPED reason=release-transaction-active"
    exit 75
  }

  if pgrep -f '(/usr/local/sbin/aibrain-deploy-gateway|/opt/aibrain-company-qa/ghcr-ops/manage-release\.mjs)' >/dev/null 2>&1; then
    log "ARNALL_STORAGE_CLEANUP_SKIPPED reason=release-process-active"
    exit 75
  fi
}

load_release_state() {
  require_regular_root_file "$STATE_FILE"
  jq -e --arg installation "$INSTALLATION_ID" '
    .schemaVersion == 3
    and .installationId == $installation
    and (.current.revision | test("^[0-9a-f]{40}$"))
    and (.current.image | test("^ghcr\\.io/arnautxu/aibrain@sha256:[0-9a-f]{64}$"))
    and (.current.egressImage | test("^ghcr\\.io/arnautxu/aibrain-egress@sha256:[0-9a-f]{64}$"))
    and ((.previous // null) == null or (
      (.previous.revision | test("^[0-9a-f]{40}$"))
      and (.previous.image | test("^ghcr\\.io/arnautxu/aibrain@sha256:[0-9a-f]{64}$"))
      and (.previous.egressImage | test("^ghcr\\.io/arnautxu/aibrain-egress@sha256:[0-9a-f]{64}$"))
    ))
  ' "$STATE_FILE" >/dev/null || fail "invalid-release-state"
}

verify_health() {
  bounded curl --fail --silent --show-error --max-time 15 "$LIVE_URL" >/dev/null \
    || fail "live-health-failed"
  bounded curl --fail --silent --show-error --max-time 15 "$READY_URL" >/dev/null \
    || fail "ready-health-failed"
}

verify_current_runtime() {
  local revision image container details found
  revision="$(jq -er '.current.revision' "$STATE_FILE")"
  for image in "$(jq -er '.current.image' "$STATE_FILE")" "$(jq -er '.current.egressImage' "$STATE_FILE")"; do
    found=0
    while IFS= read -r container; do
      [[ -n "$container" ]] || continue
      found=1
      details="$(bounded docker container inspect --format \
        '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.graphikai.aibrain.installation"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$container")" || fail "runtime-inspect-failed container=$container"
      [[ "$details" == "true|healthy|${COMPOSE_PROJECT}|${INSTALLATION_ID}|${revision}" ]] \
        || fail "runtime-identity-or-health-mismatch container=$container"
    done < <(bounded docker ps --quiet --filter "ancestor=$image" --filter "label=com.graphikai.aibrain.installation=${INSTALLATION_ID}")
    ((found == 1)) || fail "current-image-has-no-running-container image=$image"
  done
}

is_protected_revision_name() {
  local name="$1" current previous
  current="$(jq -er '.current.revision' "$STATE_FILE")"
  previous="$(jq -r '.previous.revision? // empty' "$STATE_FILE")"
  [[ "$name" == *"$current"* || ( -n "$previous" && "$name" == *"$previous"* ) ]]
}

is_allowlisted_directory() {
  local parent="$1" name="$2"
  case "$parent" in
    "$STORAGE_ROOT/quarantine")
      [[ "$name" =~ ^[0-9a-f]{40}(\.failed-(preflight|precheck|active-health)-[0-9]{8}T[0-9]{4}Z|-(aborted-low-disk-attempt-[0-9]+|preflight-attempt-[0-9]+))$ ]]
      ;;
    "$STORAGE_ROOT/failed-releases")
      [[ "$name" =~ ^[0-9a-f]{40}-buildx-missing-[0-9]{8}T[0-9]{4}Z$ ]]
      ;;
    "$STORAGE_ROOT/incoming")
      [[ "$name" =~ ^failed-[0-9a-f]{40}-[0-9]{8}T[0-9]{6}Z$ ]]
      ;;
    *) return 1 ;;
  esac
}

directory_is_old_enough() {
  local target="$1" modified now
  modified="$(stat -c '%Y' "$target")"
  now="$(date +%s)"
  ((now - modified >= MIN_AGE_DAYS * 86400))
}

safe_directory_bytes() {
  local target="$1" bytes
  bytes="$(bounded du -sb --one-file-system -- "$target" | awk '{print $1}')" \
    || fail "directory-size-failed path=$target"
  [[ "$bytes" =~ ^[0-9]+$ ]] || fail "directory-size-invalid path=$target"
  printf '%s\n' "$bytes"
}

cleanup_release_staging() {
  local parent target name canonical mode_bits bytes
  for parent in "$STORAGE_ROOT/quarantine" "$STORAGE_ROOT/failed-releases" "$STORAGE_ROOT/incoming"; do
    [[ -d "$parent" && ! -L "$parent" ]] || continue
    [[ "$(stat -c '%u' "$parent")" == "0" ]] || fail "non-root-allowlist-parent path=$parent"
    while IFS= read -r -d '' target; do
      check_deadline
      name="${target##*/}"
      is_allowlisted_directory "$parent" "$name" || {
        log "ARNALL_STORAGE_CLEANUP_PRESERVED category=release-staging path=$target reason=unrecognized-name"
        continue
      }
      directory_is_old_enough "$target" || {
        log "ARNALL_STORAGE_CLEANUP_PRESERVED category=release-staging path=$target reason=retention"
        continue
      }
      is_protected_revision_name "$name" && {
        log "ARNALL_STORAGE_CLEANUP_PRESERVED category=release-staging path=$target reason=rollback-reserve"
        continue
      }
      [[ ! -L "$target" && "$(stat -c '%u' "$target")" == "0" ]] \
        || fail "unsafe-release-staging path=$target"
      mode_bits="$(stat -c '%a' "$target")"
      (( (8#$mode_bits & 8#022) == 0 )) || fail "writable-release-staging path=$target"
      canonical="$(realpath --canonicalize-existing -- "$target")"
      [[ "${canonical%/*}" == "$parent" ]] || fail "release-staging-escaped-parent path=$target"
      ! mountpoint --quiet "$target" || fail "release-staging-is-mountpoint path=$target"
      [[ -z "$(bounded find "$target" -xdev -type d -name .git -print -quit)" ]] \
        || fail "release-staging-contains-git path=$target"
      bytes="$(safe_directory_bytes "$target")"
      log "ARNALL_STORAGE_CLEANUP_CANDIDATE category=release-staging path=$target logical_bytes=$bytes mode=$mode"
      if [[ "$mode" == "execute" ]]; then
        bounded rm -rf --one-file-system -- "$target" || fail "directory-remove-failed path=$target"
        [[ ! -e "$target" ]] || fail "directory-still-present path=$target"
        ((directory_bytes += bytes, directories_removed += 1))
        log "ARNALL_STORAGE_CLEANUP_REMOVED category=release-staging path=$target logical_bytes=$bytes"
      fi
    done < <(find "$parent" -mindepth 1 -maxdepth 1 -type d -print0)
  done
}

is_aibrain_reference() {
  [[ "$1" =~ ^ghcr\.io/arnautxu/aibrain(-egress)?(@sha256:[0-9a-f]{64}|:[A-Za-z0-9._-]+)$ ]]
}

is_protected_image() {
  local image="$1"
  jq -e --arg image "$image" '
    [.current.image, .current.egressImage, .previous.image?, .previous.egressImage?]
    | map(select(. != null)) | index($image) != null
  ' "$STATE_FILE" >/dev/null
}

image_id_is_protected() {
  local candidate_id="$1" protected protected_id
  while IFS= read -r protected; do
    [[ -n "$protected" ]] || continue
    protected_id="$(bounded docker image inspect --format '{{.Id}}' "$protected" 2>/dev/null || true)"
    [[ "$candidate_id" != "$protected_id" ]] || return 0
  done < <(jq -r '.current.image, .current.egressImage, .previous.image?, .previous.egressImage? // empty' "$STATE_FILE")
  return 1
}

cleanup_one_image() {
  local image="$1" image_id title source size reference container details created created_epoch now
  local -a removable_containers=()
  is_protected_image "$image" && return 0
  bounded docker image inspect "$image" >/dev/null 2>&1 || return 0
  image_id="$(bounded docker image inspect --format '{{.Id}}' "$image")" \
    || fail "image-inspect-failed image=$image"
  image_id_is_protected "$image_id" && {
    log "ARNALL_STORAGE_CLEANUP_PRESERVED category=docker-image image=$image reason=rollback-image-id"
    return 0
  }
  title="$(bounded docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.title"}}' "$image")"
  source="$(bounded docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$image")"
  [[ "$title" == "AiBrain Company Brain" || "$title" == "AiBrain Egress Gateway" ]] \
    || fail "unexpected-image-title image=$image"
  [[ "$source" == "https://github.com/arnautxu/AiBrain" ]] || fail "unexpected-image-source image=$image"
  created="$(bounded docker image inspect --format '{{.Created}}' "$image")" \
    || fail "image-created-time-unavailable image=$image"
  created_epoch="$(date --date="$created" +%s)" || fail "image-created-time-invalid image=$image"
  now="$(date +%s)"
  if ((now - created_epoch < MIN_AGE_DAYS * 86400)); then
    log "ARNALL_STORAGE_CLEANUP_PRESERVED category=docker-image image=$image reason=retention"
    return 0
  fi

  while IFS= read -r reference; do
    [[ -z "$reference" || "$reference" == "<none>:<none>" ]] && continue
    is_aibrain_reference "$reference" || {
      log "ARNALL_STORAGE_CLEANUP_PRESERVED category=docker-image image=$image reason=shared-reference reference=$reference"
      return 0
    }
  done < <(bounded docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}{{range .RepoDigests}}{{println .}}{{end}}' "$image_id")

  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    details="$(bounded docker container inspect --format \
      '{{.State.Running}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.graphikai.aibrain.installation"}}|{{index .Config.Labels "com.graphikai.aibrain.product"}}' \
      "$container")" || fail "container-inspect-failed container=$container"
    [[ "$details" == "false|${image_id}|${COMPOSE_PROJECT}|${INSTALLATION_ID}|aibrain" ]] || {
      log "ARNALL_STORAGE_CLEANUP_PRESERVED category=docker-image image=$image reason=container-reference container=$container"
      return 0
    }
    removable_containers+=("$container")
  done < <(bounded docker ps --all --quiet --no-trunc --filter "ancestor=$image")

  size="$(bounded docker image inspect --format '{{.Size}}' "$image")"
  [[ "$size" =~ ^[0-9]+$ ]] || fail "image-size-invalid image=$image"
  log "ARNALL_STORAGE_CLEANUP_CANDIDATE category=docker-image image=$image logical_bytes=$size mode=$mode"
  [[ "$mode" == "execute" ]] || return 0

  for container in "${removable_containers[@]}"; do
    details="$(bounded docker container inspect --format '{{.State.Running}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.graphikai.aibrain.installation"}}' "$container")"
    [[ "$details" == "false|${image_id}|${COMPOSE_PROJECT}|${INSTALLATION_ID}" ]] \
      || fail "container-changed-before-remove container=$container"
    bounded docker container rm "$container" >/dev/null || fail "container-remove-failed container=$container"
    ((containers_removed += 1))
    log "ARNALL_STORAGE_CLEANUP_REMOVED category=stopped-container container=$container"
  done
  [[ -z "$(bounded docker ps --all --quiet --no-trunc --filter "ancestor=$image")" ]] \
    || fail "image-gained-container-reference image=$image"
  bounded docker image rm "$image" >/dev/null || fail "image-remove-failed image=$image"
  ((image_bytes += size, images_removed += 1))
  log "ARNALL_STORAGE_CLEANUP_REMOVED category=docker-image image=$image logical_bytes=$size"
}

cleanup_inactive_images() {
  local image
  while IFS= read -r image; do
    check_deadline
    [[ -n "$image" && "$image" != "<none>@<none>" ]] || continue
    [[ "$image" =~ ^(${APP_REPOSITORY}|${EGRESS_REPOSITORY})@sha256:[0-9a-f]{64}$ ]] || continue
    cleanup_one_image "$image"
  done < <(bounded docker image ls --digests --no-trunc --format '{{.Repository}}@{{.Digest}}' | sort -u)
}

main() {
  local free_before free_after freed=0
  parse_args "$@"
  started_at_epoch="$(date +%s)"
  for command in awk curl date df docker du find flock install jq mountpoint pgrep realpath rm sort stat tail timeout tr; do
    require_command "$command"
  done
  acquire_locks_and_release_guard
  load_release_state
  verify_health
  verify_current_runtime
  free_before="$(df --block-size=1 --output=avail / | tail -1 | tr -d ' ')"
  log "ARNALL_STORAGE_CLEANUP_STARTED mode=$mode free_bytes_before=$free_before retention_days=$MIN_AGE_DAYS"
  cleanup_release_staging
  cleanup_inactive_images
  verify_health
  verify_current_runtime
  free_after="$(df --block-size=1 --output=avail / | tail -1 | tr -d ' ')"
  ((free_after > free_before)) && freed=$((free_after - free_before))
  log "ARNALL_STORAGE_CLEANUP_COMPLETE mode=$mode free_bytes_before=$free_before free_bytes_after=$free_after bytes_freed=$freed directory_logical_bytes=$directory_bytes image_logical_bytes=$image_bytes directories_removed=$directories_removed containers_removed=$containers_removed images_removed=$images_removed"
}

main "$@"
