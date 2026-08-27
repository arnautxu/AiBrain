#!/usr/bin/env bash

set -euo pipefail

readonly INSTALLATION_ID="company-qa"
readonly COMPOSE_PROJECT="aibrain-company-qa"
readonly RELEASE_ROOT="/opt/aibrain-company-qa"
readonly RELEASES_DIR="${RELEASE_ROOT}/releases"
readonly CONFIG_DIR="/etc/aibrain/company-qa"
readonly ACTIVE_ENV="${CONFIG_DIR}/compose.env"
readonly ACTIVE_CONFIG="${CONFIG_DIR}/installation.json"
readonly STATE_FILE="${CONFIG_DIR}/release-state.json"
readonly REGISTRY="127.0.0.1:5000"
readonly APP_REPOSITORY="${REGISTRY}/aibrain-company-qa"
readonly EGRESS_REPOSITORY="${REGISTRY}/aibrain-company-qa-egress"
readonly CONTEXT_ROOT="/var/lib/docker/volumes/aibrain-company-qa-data/_data/company-context"
readonly MAX_ARCHIVE_BYTES=$((64 * 1024 * 1024))
readonly MIN_FREE_BYTES=$((12 * 1024 * 1024 * 1024))

fail() {
  printf 'ARNALL_DEPLOY_FAILED: %s\n' "$1" >&2
  exit 1
}

require_root_owned_file() {
  local file="$1"
  [[ -f "$file" && ! -L "$file" ]] || fail "missing controlled file: ${file}"
  [[ "$(stat -c '%u' "$file")" == "0" ]] || fail "file is not root-owned: ${file}"
  (( (8#$(stat -c '%a' "$file") & 8#022) == 0 )) || fail "file is group/world writable: ${file}"
  [[ "$(stat -c '%h' "$file")" == "1" ]] || fail "file has unexpected hard links: ${file}"
}

validate_archive() {
  local archive="$1"
  local entry type
  [[ "$(stat -c '%s' "$archive")" -le "$MAX_ARCHIVE_BYTES" ]] || fail "source archive exceeds 64 MiB"
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    [[ "$entry" != /* && ! "$entry" =~ (^|/)\.\.(/|$) ]] || fail "source archive contains an unsafe path"
  done < <(tar -tf "$archive")
  while IFS= read -r type; do
    [[ "$type" == "-" || "$type" == "d" ]] || fail "source archive contains links or special files"
  done < <(tar -tvf "$archive" | cut -c1)
}

replace_release_values() {
  local source="$1" target="$2" image="$3" egress_image="$4" revision="$5"
  awk -v image="$image" -v egress_image="$egress_image" -v revision="$revision" '
    /^AIBRAIN_IMAGE=/ { print "AIBRAIN_IMAGE=" image; next }
    /^AIBRAIN_EGRESS_IMAGE=/ { print "AIBRAIN_EGRESS_IMAGE=" egress_image; next }
    /^AIBRAIN_REVISION=/ { print "AIBRAIN_REVISION=" revision; next }
    { print }
  ' "$source" > "$target"
  chmod 0600 "$target"
  chown root:root "$target"
}

new_dangling_images() {
  local before="$1" after="$2"
  docker image ls --filter dangling=true --quiet --no-trunc | sort -u > "$after"
  comm -13 "$before" "$after"
}

sync_company_context() {
  local source="$1" file temporary
  install -d -m 0700 -o 10001 -g 10001 "$CONTEXT_ROOT"
  while IFS= read -r -d '' file; do
    temporary="${CONTEXT_ROOT}/.$(basename "$file").pending-$$"
    install -m 0400 -o 10001 -g 10001 "$file" "$temporary"
    mv -f "$temporary" "${CONTEXT_ROOT}/$(basename "$file")"
  done < <(find "$source" -maxdepth 1 -type f -name '*.md' -print0)
}

main() {
  [[ "$(id -u)" == "0" ]] || fail "deployment gateway must run as root"
  [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]] || fail "unsupported deploy command"
  local revision="${BASH_REMATCH[1]}"
  local short_revision="${revision:0:7}"
  local release_dir="${RELEASES_DIR}/${revision}"
  local incoming_dir="${RELEASE_ROOT}/incoming"
  local archive="${incoming_dir}/${revision}.$$.tar"
  local target_env="${CONFIG_DIR}/compose.env.target-${short_revision}"
  local target_config="${CONFIG_DIR}/installation.target-${short_revision}.json"
  local compose_file current_compose current_revision current_short
  local app_tag egress_tag app_image egress_image free_bytes
  local dangling_before dangling_after manager_args

  umask 077
  install -d -m 0700 -o root -g root "$RELEASE_ROOT" "$RELEASES_DIR" "$incoming_dir" "$CONFIG_DIR"
  exec 9>"${RELEASE_ROOT}/deploy.lock"
  flock --exclusive --nonblock 9 || fail "another Arnall deployment is running"

  require_root_owned_file "$ACTIVE_ENV"
  require_root_owned_file "$ACTIVE_CONFIG"
  grep -qx "AIBRAIN_INSTALLATION_ID=${INSTALLATION_ID}" "$ACTIVE_ENV" || fail "active env belongs to another installation"
  grep -qx "AIBRAIN_COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT}" "$ACTIVE_ENV" || fail "active env targets another Compose project"

  if [[ -f "$STATE_FILE" ]] && jq -e --arg revision "$revision" '.current.revision == $revision' "$STATE_FILE" >/dev/null; then
    printf 'ARNALL_DEPLOY_ALREADY_CURRENT revision=%s\n' "$revision"
    exit 0
  fi
  [[ ! -e "$release_dir" ]] || fail "release directory already exists for a non-current revision"

  dd if=/dev/stdin of="$archive" bs=1M count=65 iflag=fullblock status=none
  validate_archive "$archive"
  install -d -m 0700 -o root -g root "$release_dir"
  tar --extract --file="$archive" --directory="$release_dir" --no-same-owner --no-same-permissions
  rm -f "$archive"
  chown -R root:root "$release_dir"
  find "$release_dir" -type d -exec chmod go-w {} +
  find "$release_dir" -type f -exec chmod go-w {} +

  compose_file="${release_dir}/infra/hetzner/compose.yaml"
  [[ -f "${release_dir}/Dockerfile" ]] || fail "release archive has no Dockerfile"
  [[ -f "${release_dir}/scripts/manage-release.mjs" ]] || fail "release archive has no release manager"
  [[ -f "$compose_file" ]] || fail "release archive has no Compose contract"
  [[ -f "${release_dir}/infra/hetzner/browser/seccomp_profile.json" ]] || fail "release archive has no seccomp profile"
  [[ -f "${release_dir}/config/installations/arnall.qa.example.json" ]] || fail "release archive has no Arnall installation config"
  [[ -d "${release_dir}/config/company-context/arnall" ]] || fail "release archive has no Arnall company context"
  chmod 0644 "$compose_file" "${release_dir}/infra/hetzner/browser/seccomp_profile.json"

  free_bytes="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
  [[ "$free_bytes" =~ ^[0-9]+$ && "$free_bytes" -ge "$MIN_FREE_BYTES" ]] || fail "insufficient free disk for a bounded image build"

  install -d -m 0755 -o root -g root "${RELEASE_ROOT}/node_modules"
  if [[ ! -f "${RELEASE_ROOT}/node_modules/js-yaml/package.json" ]]; then
    npm install --prefix "$RELEASE_ROOT" --no-save --ignore-scripts --omit=dev js-yaml@4.3.2
  fi

  dangling_before="$(mktemp "${RELEASE_ROOT}/dangling-before.XXXXXX")"
  dangling_after="$(mktemp "${RELEASE_ROOT}/dangling-after.XXXXXX")"
  docker image ls --filter dangling=true --quiet --no-trunc | sort -u > "$dangling_before"

  app_tag="${APP_REPOSITORY}:${revision}"
  egress_tag="${EGRESS_REPOSITORY}:${revision}"
  docker build --pull --target runtime --build-arg "AIBRAIN_REVISION=${revision}" --tag "$app_tag" "$release_dir"
  docker build --pull --target egress-gateway --build-arg "AIBRAIN_REVISION=${revision}" --tag "$egress_tag" "$release_dir"
  docker push "$app_tag"
  docker push "$egress_tag"
  app_image="$(docker image inspect --format '{{index .RepoDigests 0}}' "$app_tag")"
  egress_image="$(docker image inspect --format '{{index .RepoDigests 0}}' "$egress_tag")"
  [[ "$app_image" =~ @sha256:[0-9a-f]{64}$ ]] || fail "application image digest is unavailable"
  [[ "$egress_image" =~ @sha256:[0-9a-f]{64}$ ]] || fail "egress image digest is unavailable"

  replace_release_values "$ACTIVE_ENV" "$target_env" "$app_image" "$egress_image" "$revision"
  install -m 0400 -o root -g root "${release_dir}/config/installations/arnall.qa.example.json" "$target_config"

  manager_args=(
    promote
    --image "$app_image"
    --egress-image "$egress_image"
    --revision "$revision"
    --installation-id "$INSTALLATION_ID"
    --env-file "$ACTIVE_ENV"
    --target-env-file "$target_env"
    --compose-file "$compose_file"
    --installation-config "$target_config"
    --state-file "$STATE_FILE"
    --health-timeout-ms 240000
    --docker-command-timeout-ms 240000
  )

  if [[ ! -f "$STATE_FILE" ]]; then
    current_revision="$(sed -n 's/^AIBRAIN_REVISION=//p' "$ACTIVE_ENV")"
    [[ "$current_revision" =~ ^[0-9a-f]{7,40}$ ]] || fail "active revision is invalid"
    current_short="${current_revision:0:7}"
    current_compose="${RELEASES_DIR}/${current_short}/infra/hetzner/compose.yaml"
    [[ -f "$current_compose" ]] || fail "bootstrap Compose input is missing"
    chown root:root "$current_compose" "$(dirname "$current_compose")/browser/seccomp_profile.json"
    chmod 0644 "$current_compose" "$(dirname "$current_compose")/browser/seccomp_profile.json"
    docker compose --env-file "$ACTIVE_ENV" -f "$current_compose" up -d --no-deps alert-dispatcher
    manager_args+=(--current-compose-file "$current_compose")
  else
    docker compose --env-file "$ACTIVE_ENV" -f "${STATE_FILE}.active.compose.yaml" up -d --no-deps alert-dispatcher
  fi

  node "${release_dir}/scripts/manage-release.mjs" "${manager_args[@]}"
  sync_company_context "${release_dir}/config/company-context/arnall"

  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/live >/dev/null
  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/ready >/dev/null

  new_dangling_images "$dangling_before" "$dangling_after" | while IFS= read -r image_id; do
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
    docker image rm "$image_id" >/dev/null 2>&1 || true
  done
  rm -f "$dangling_before" "$dangling_after"

  jq -n --arg revision "$revision" --arg image "$app_image" --arg egressImage "$egress_image" \
    '{schemaVersion:1,installationId:"company-qa",revision:$revision,image:$image,egressImage:$egressImage,deployedAt:(now|todateiso8601)}' \
    > "${CONFIG_DIR}/last-deployment.json.pending"
  chmod 0600 "${CONFIG_DIR}/last-deployment.json.pending"
  mv -f "${CONFIG_DIR}/last-deployment.json.pending" "${CONFIG_DIR}/last-deployment.json"
  printf 'ARNALL_DEPLOY_OK revision=%s\n' "$revision"
}

main "$@"
