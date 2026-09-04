#!/usr/bin/env bash

set -euo pipefail

readonly INSTALLATION_ID="company-qa"
readonly COMPOSE_PROJECT="aibrain-company-qa"
readonly RELEASE_ROOT="/opt/aibrain-company-qa"
readonly OPS_ROOT="${RELEASE_ROOT}/ghcr-ops"
readonly CONFIG_DIR="/etc/aibrain/company-qa"
readonly ACTIVE_ENV="${CONFIG_DIR}/compose.env"
readonly AUTOMATION_WORKER_ENABLED="true"
readonly ACTIVE_CONFIG="${CONFIG_DIR}/installation.json"
readonly STATE_FILE="${CONFIG_DIR}/release-state.json"
readonly EGRESS_ENV="${CONFIG_DIR}/egress.env"
readonly ALERTS_ENV="${CONFIG_DIR}/alerts.env"
readonly GHCR_APP_REPOSITORY="ghcr.io/arnautxu/aibrain"
readonly GHCR_EGRESS_REPOSITORY="ghcr.io/arnautxu/aibrain-egress"
readback_staging=""
readback_evidence_parent=""
readback_revision=""

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

require_root_owned_directory() {
  local directory="$1"
  [[ -d "$directory" && ! -L "$directory" ]] || fail "missing controlled directory: ${directory}"
  [[ "$(stat -c '%u' "$directory")" == "0" ]] || fail "directory is not root-owned: ${directory}"
  (( (8#$(stat -c '%a' "$directory") & 8#077) == 0 )) || fail "directory is accessible by non-root users: ${directory}"
}

read_unique_env_value() {
  local file="$1" key="$2" count value
  count="$(awk -F= -v key="$key" '$1 == key { count += 1 } END { print count + 0 }' "$file")"
  [[ "$count" == "1" ]] || fail "${key} must occur exactly once in its controlled env file"
  value="$(awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2); exit }' "$file")"
  [[ -n "$value" ]] || fail "${key} is required in its controlled env file"
  printf '%s' "$value"
}

validate_release_secret_contract() {
  local health_token alert_health_token channel_token key
  grep -qx "AIBRAIN_EGRESS_ENV_FILE=${EGRESS_ENV}" "$ACTIVE_ENV" \
    || fail "active env targets an unexpected egress policy file"
  grep -qx "AIBRAIN_ALERTS_ENV_FILE=${ALERTS_ENV}" "$ACTIVE_ENV" \
    || fail "active env targets an unexpected alerts policy file"
  require_root_owned_file "$EGRESS_ENV"
  require_root_owned_file "$ALERTS_ENV"
  health_token="$(read_unique_env_value "$EGRESS_ENV" AIBRAIN_EGRESS_HEALTH_TOKEN)"
  alert_health_token="$(read_unique_env_value "$ALERTS_ENV" AIBRAIN_ALERT_EGRESS_HEALTH_TOKEN)"
  [[ "$health_token" =~ ^[A-Za-z0-9_-]{32,256}$ ]] \
    || fail "AIBRAIN_EGRESS_HEALTH_TOKEN must be a strong channel token"
  [[ "$alert_health_token" == "$health_token" ]] \
    || fail "alert dispatcher health token does not match the egress health token"
  for key in AIBRAIN_EGRESS_BROWSER_TOKEN AIBRAIN_EGRESS_WORKER_TOKEN AIBRAIN_EGRESS_SERVER_TOKEN; do
    channel_token="$(read_unique_env_value "$EGRESS_ENV" "$key")"
    [[ "$channel_token" != "$health_token" ]] \
      || fail "AIBRAIN_EGRESS_HEALTH_TOKEN must be distinct from every egress channel token"
  done
}

require_release_readback_runtime() {
  node --input-type=module --eval '
    const major = Number.parseInt(process.versions.node.split(".")[0], 10);
    if (!Number.isInteger(major) || major < 22) process.exit(64);
  ' >/dev/null 2>&1 || fail "host Node runtime cannot execute the release readback collector"
}

require_noninteractive_browser_policy() {
  local compose_file="$1" effective
  effective="$(docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" config --format json)" \
    || fail "effective Compose policy cannot be resolved"
  jq -e '
    .services.app.environment.CODEX_APPROVAL_POLICY == "never" and
    .services.app.environment.AIBRAIN_BROWSER_INTERACTIVE_APPROVALS == "disabled" and
    .services["automation-worker"].environment.CODEX_APPROVAL_POLICY == "never" and
    .services["automation-worker"].environment.AIBRAIN_BROWSER_INTERACTIVE_APPROVALS == "disabled"
  ' <<<"$effective" >/dev/null || fail "effective Compose policy permits interactive browser approvals"
}

runtime_noninteractive_browser_policy_is_active() {
  local compose_file="$1" service container
  for service in app automation-worker; do
    container="$(docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" ps -q "$service")"
    [[ "$container" =~ ^[a-f0-9]{12,64}$ ]] || return 1
    docker container inspect "$container" --format '{{json .Config.Env}}' \
      | jq -e '
        index("CODEX_APPROVAL_POLICY=never") != null and
        index("AIBRAIN_BROWSER_INTERACTIVE_APPROVALS=disabled") != null
      ' >/dev/null || return 1
  done
}

cleanup_readback_staging() {
  local status="$?"
  set +e
  if [[ -n "${readback_staging:-}" && -d "$readback_staging" && ! -L "$readback_staging" \
    && "$readback_staging" == "${readback_evidence_parent}/.${readback_revision}."* ]]; then
    rm -rf --one-file-system -- "$readback_staging"
  fi
  exit "$status"
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

set_automation_worker_flag() {
  local target_env="$1"
  if grep -q '^AIBRAIN_AUTOMATION_WORKER_ENABLED=' "$target_env"; then
    sed -i "s/^AIBRAIN_AUTOMATION_WORKER_ENABLED=.*/AIBRAIN_AUTOMATION_WORKER_ENABLED=${AUTOMATION_WORKER_ENABLED}/" "$target_env"
  else
    printf '\nAIBRAIN_AUTOMATION_WORKER_ENABLED=%s\n' "$AUTOMATION_WORKER_ENABLED" >> "$target_env"
  fi
}

automation_worker_is_healthy() {
  local compose_file="${STATE_FILE}.active.compose.yaml"
  local worker_container worker_state
  [[ -f "$compose_file" && ! -L "$compose_file" ]] || return 1
  grep -qx "AIBRAIN_AUTOMATION_WORKER_ENABLED=${AUTOMATION_WORKER_ENABLED}" "$ACTIVE_ENV" || return 1
  worker_container="$(docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" ps -q automation-worker)"
  [[ "$worker_container" =~ ^[a-f0-9]{12,64}$ ]] || return 1
  worker_state="$(docker container inspect --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$worker_container" 2>/dev/null || true)"
  [[ "$worker_state" == "true|healthy" ]]
}

cleanup_ghcr_credentials() {
  local status="$?"
  if [[ -n "${ghcr_docker_config:-}" && -d "$ghcr_docker_config" && ! -L "$ghcr_docker_config" ]]; then
    rm -rf --one-file-system -- "$ghcr_docker_config"
  fi
  exit "$status"
}

verify_current_main() {
  local revision="$1" token="$2" remote_sha
  # Token goes through stdin, never argv, a durable file, or diagnostic output.
  [[ "$token" =~ ^[A-Za-z0-9_]+$ ]] || fail "deployment token has invalid characters"
  remote_sha="$(printf 'header = "Authorization: Bearer %s"\n' "$token" | \
    curl --config - --fail --silent --show-error --connect-timeout 10 --max-time 20 \
      -H 'Accept: application/vnd.github+json' \
      'https://api.github.com/repos/arnautxu/AiBrain/git/ref/heads/main' | jq -er '.object.sha')" \
    || fail "cannot verify current GitHub main; promotion refused"
  [[ "$remote_sha" == "$revision" ]] || fail "candidate superseded by current GitHub main; promotion refused"
}

pull_ghcr_images() {
  local app_image="$1" egress_image="$2" ghcr_user="$3" revision="$4" ghcr_token=""
  [[ "$app_image" =~ ^${GHCR_APP_REPOSITORY}@sha256:[0-9a-f]{64}$ ]] || fail "application image is not the approved GHCR repository and digest"
  [[ "$egress_image" =~ ^${GHCR_EGRESS_REPOSITORY}@sha256:[0-9a-f]{64}$ ]] || fail "egress image is not the approved GHCR repository and digest"
  [[ "$ghcr_user" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || fail "GHCR username is invalid"
  IFS= read -r ghcr_token || [[ -n "$ghcr_token" ]] || fail "GHCR pull token was not supplied"
  [[ -n "$ghcr_token" ]] || fail "GHCR pull token was empty"
  verify_current_main "$revision" "$ghcr_token"
  umask 077
  ghcr_docker_config="$(mktemp -d "${RELEASE_ROOT}/.ghcr-docker.XXXXXX")"
  trap cleanup_ghcr_credentials EXIT
  printf '%s' "$ghcr_token" | docker --config "$ghcr_docker_config" login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null
  docker --config "$ghcr_docker_config" pull "$app_image" >/dev/null
  docker --config "$ghcr_docker_config" pull "$egress_image" >/dev/null
  # This runs under deploy.lock, AFTER slow image pulls and before any service
  # mutation. A concurrent main push invalidates this candidate, not user work.
  verify_current_main "$revision" "$ghcr_token"
  unset ghcr_token
}

is_aibrain_image_reference() {
  local reference="$1"
  [[ "$reference" == 127.0.0.1:5000/aibrain-company-qa:* || "$reference" == 127.0.0.1:5000/aibrain-company-qa-egress:* \
    || "$reference" == ${GHCR_APP_REPOSITORY}:* || "$reference" == ${GHCR_EGRESS_REPOSITORY}:* \
    || "$reference" == ${GHCR_APP_REPOSITORY}@sha256:* || "$reference" == ${GHCR_EGRESS_REPOSITORY}@sha256:* ]]
}

is_current_aibrain_image() {
  local image="$1"
  jq -e --arg image "$image" '.current.image == $image or .current.egressImage == $image' "$STATE_FILE" >/dev/null
}

current_aibrain_image_id_matches() {
  local image_id="$1" current_image current_image_id
  while IFS= read -r current_image; do
    [[ -n "$current_image" ]] || continue
    current_image_id="$(docker image inspect --format '{{.Id}}' "$current_image" 2>/dev/null || true)"
    [[ "$current_image_id" == "$image_id" ]] && return 0
  done < <(jq -r '.current.image, .current.egressImage' "$STATE_FILE")
  return 1
}

report_cleanup_blocked() {
  local image="$1" reason="$2" detail="$3"
  printf 'ARNALL_RELEASE_CLEANUP_BLOCKED image=%s reason=%s detail=%s\n' "$image" "$reason" "$detail" >&2
}

remove_obsolete_aibrain_containers() {
  local image="$1" image_id="$2" container details running container_image project
  local -a obsolete_containers=()
  while IFS= read -r container; do
    [[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || continue
    details="$(docker container inspect --format '{{.State.Running}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null || true)"
    IFS='|' read -r running container_image project <<< "$details"
    if [[ "$running" == "true" || "$container_image" != "$image_id" || "$project" != "$COMPOSE_PROJECT" ]]; then
      report_cleanup_blocked "$image" "container-reference" "container=${container},running=${running:-unknown},image=${container_image:-unknown},project=${project:-unknown}"
      return 1
    fi
    obsolete_containers+=("$container")
  done < <(docker ps --all --quiet --filter "ancestor=${image_id}")
  for container in ${obsolete_containers[@]+"${obsolete_containers[@]}"}; do
    docker container rm "$container" >/dev/null
    printf 'ARNALL_RELEASE_CLEANUP_REMOVED_CONTAINER image=%s container=%s\n' "$image" "$container"
  done
  return 0
}

remove_unused_aibrain_image() {
  local image="$1" image_id label reference
  local -a image_references=()
  [[ "$image" =~ ^(127\.0\.0\.1:5000/aibrain-company-qa|127\.0\.0\.1:5000/aibrain-company-qa-egress|${GHCR_APP_REPOSITORY}|${GHCR_EGRESS_REPOSITORY})@sha256:[0-9a-f]{64}$ ]] || return 0
  is_current_aibrain_image "$image" && return 0
  image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 0
  label="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.title"}}' "$image_id")"
  [[ "$label" == "AiBrain Company Brain" || "$label" == "AiBrain Egress Gateway" ]] || fail "refusing to remove a non-AiBrain image"
  while IFS= read -r reference; do
    [[ -n "$reference" && "$reference" != "<none>:<none>" ]] || continue
    is_aibrain_image_reference "$reference" || {
      report_cleanup_blocked "$image" "shared-image-reference" "reference=${reference}"
      return 1
    }
    image_references+=("$reference")
  done < <(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}{{range .RepoDigests}}{{println .}}{{end}}' "$image_id")
  if current_aibrain_image_id_matches "$image_id"; then
    report_cleanup_blocked "$image" "current-image-id" "image_id=${image_id}"
    return 1
  fi
  remove_obsolete_aibrain_containers "$image" "$image_id" || return 1
  if ((${#image_references[@]})); then
    for reference in "${image_references[@]}"; do
      # Docker can expose several RepoDigests for one image ID. Removing the
      # first reference may atomically remove the remaining aliases as well,
      # so a later missing alias is already the desired end state.
      docker image inspect "$reference" >/dev/null 2>&1 || continue
      docker image rm "$reference" >/dev/null || {
        report_cleanup_blocked "$image" "image-remove-failed" "reference=${reference}"
        return 1
      }
    done
  else
    docker image rm "$image_id" >/dev/null || {
      report_cleanup_blocked "$image" "image-remove-failed" "image_id=${image_id}"
      return 1
    }
  fi
  printf 'ARNALL_RELEASE_CLEANUP_REMOVED_IMAGE image=%s image_id=%s\n' "$image" "$image_id"
}

cleanup_previous_aibrain_images() {
  local image
  [[ -f "$STATE_FILE" ]] || return 0
  while IFS= read -r image; do
    remove_unused_aibrain_image "$image" || return 1
  done < <(jq -r '.previous.image?, .previous.egressImage? // empty' "$STATE_FILE")
}

cleanup_inactive_aibrain_images() {
  local image
  [[ -f "$STATE_FILE" ]] || return 0
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    remove_unused_aibrain_image "$image" || return 1
  done < <(
    {
      jq -r '.previous.image?, .previous.egressImage? // empty' "$STATE_FILE"
      docker image ls --digests --no-trunc --format '{{.Repository}}@{{.Digest}}'
    } | sort -u
  )
}

cleanup_legacy_release_directories() {
  local legacy_root="${RELEASE_ROOT}/releases"
  local current_revision previous_revision target revision
  [[ -d "$legacy_root" && ! -L "$legacy_root" ]] || return 0
  [[ ! -e "${STATE_FILE}.transaction.json" ]] || fail "release transaction exists; legacy release cleanup is blocked"
  current_revision="$(jq -er '.current.revision' "$STATE_FILE")" || fail "current release revision is unavailable"
  previous_revision="$(jq -r '.previous.revision? // empty' "$STATE_FILE")"
  while IFS= read -r -d '' target; do
    revision="${target##*/}"
    [[ "$revision" =~ ^[0-9a-f]{7}([0-9a-f]{33})?$ ]] || {
      printf 'ARNALL_RELEASE_DIRECTORY_SKIPPED path=%s reason=unrecognized-name\n' "$target" >&2
      continue
    }
    [[ "$revision" != "$current_revision" && "$revision" != "${current_revision:0:7}" \
      && "$revision" != "$previous_revision" && "$revision" != "${previous_revision:0:7}" ]] || continue
    [[ ! -L "$target" && "$(stat -c '%u' "$target")" == "0" ]] \
      || fail "legacy release directory is not root-controlled: ${target}"
    (( (8#$(stat -c '%a' "$target") & 8#022) == 0 )) \
      || fail "legacy release directory is group/world writable: ${target}"
    rm -rf --one-file-system -- "$target"
    printf 'ARNALL_RELEASE_DIRECTORY_REMOVED path=%s\n' "$target"
  done < <(find "$legacy_root" -mindepth 1 -maxdepth 1 -type d -print0)
}

verify_public_health() {
  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/live >/dev/null
  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/ready >/dev/null
}

prepare_arnall_branding_config() {
  local source="$1" target="$2"
  jq -e 'if .companySlug != "arnall" then error("not the Arnall installation") else
    (if .branding.logoPath == "/branding/aibrain/logo.svg" then .branding.logoPath = "/branding/arnall/logo.jpg" else . end) |
    (if .branding.faviconPath == "/branding/aibrain/favicon.svg" then .branding.faviconPath = "/branding/arnall/logo.jpg" else . end) end' "$source" > "$target" \
    || fail "cannot prepare the reviewed Arnall branding config"
}

deploy_ghcr_release() {
  local revision="$1" app_image="$2" egress_image="$3" ghcr_user="$4"
  local short_revision="${revision:0:7}"
  local target_env="${CONFIG_DIR}/compose.env.target-${short_revision}"
  local compose_file="${OPS_ROOT}/compose.yaml"
  local manager_args target_config

  umask 077
  install -d -m 0700 -o root -g root "$RELEASE_ROOT" "$CONFIG_DIR"
  exec 9>"${RELEASE_ROOT}/deploy.lock"
  flock --exclusive --nonblock 9 || fail "another Arnall deployment is running"
  require_root_owned_file "$ACTIVE_ENV"
  require_root_owned_file "$ACTIVE_CONFIG"
  require_root_owned_file "$STATE_FILE"
  require_root_owned_file "$compose_file"
  require_root_owned_directory "${OPS_ROOT}/browser"
  require_root_owned_file "${OPS_ROOT}/browser/seccomp_profile.json"
  require_root_owned_file "${OPS_ROOT}/manage-release.mjs"
  require_root_owned_file "${OPS_ROOT}/collect-release-readbacks.mjs"
  grep -qx "AIBRAIN_INSTALLATION_ID=${INSTALLATION_ID}" "$ACTIVE_ENV" || fail "active env belongs to another installation"
  grep -qx "AIBRAIN_COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT}" "$ACTIVE_ENV" || fail "active env targets another Compose project"
  validate_release_secret_contract
  require_release_readback_runtime
  require_noninteractive_browser_policy "$compose_file"

  if jq -e --arg revision "$revision" '.current.revision == $revision' "$STATE_FILE" >/dev/null \
      && automation_worker_is_healthy \
      && runtime_noninteractive_browser_policy_is_active "${STATE_FILE}.active.compose.yaml"; then
    verify_public_health
    cleanup_inactive_aibrain_images
    cleanup_legacy_release_directories
    printf 'ARNALL_DEPLOY_ALREADY_CURRENT revision=%s\n' "$revision"
    return
  fi

  pull_ghcr_images "$app_image" "$egress_image" "$ghcr_user" "$revision"
  # Stage a target config: editing ACTIVE_CONFIG here would violate the
  # release manager's drift check and lose transactional rollback of branding.
  target_config="$(mktemp "${CONFIG_DIR}/installation.target-${short_revision}.XXXXXX")"
  prepare_arnall_branding_config "$ACTIVE_CONFIG" "$target_config"
  replace_release_values "$ACTIVE_ENV" "$target_env" "$app_image" "$egress_image" "$revision"
  set_automation_worker_flag "$target_env"
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

  docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" up -d --no-deps alert-dispatcher
  AIBRAIN_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
    node "${OPS_ROOT}/manage-release.mjs" "${manager_args[@]}"
  runtime_noninteractive_browser_policy_is_active "${STATE_FILE}.active.compose.yaml" \
    || fail "deployed runtime permits interactive browser approvals"
  verify_public_health
  cleanup_inactive_aibrain_images
  cleanup_legacy_release_directories

  jq -n --arg revision "$revision" --arg image "$app_image" --arg egressImage "$egress_image" \
    '{schemaVersion:1,installationId:"company-qa",revision:$revision,image:$image,egressImage:$egressImage,deployedAt:(now|todateiso8601)}' \
    > "${CONFIG_DIR}/last-deployment.json.pending"
  chmod 0600 "${CONFIG_DIR}/last-deployment.json.pending"
  mv -f "${CONFIG_DIR}/last-deployment.json.pending" "${CONFIG_DIR}/last-deployment.json"
  printf 'ARNALL_DEPLOY_OK revision=%s\n' "$revision"
}

validate_existing_release_readbacks() {
  local revision="$1" backend_ci_run_id="$2" publish_run_id="$3" deploy_run_id="$4"
  local app_digest="$5" gateway_digest="$6" evidence_root="$7"
  local captured_at expected_manifest actual_manifest
  local ci_file="${evidence_root}/release-ci-readback.json"
  local deploy_file="${evidence_root}/release-deploy-state.json"
  local runtime_file="${evidence_root}/release-runtime-readback.json"
  local app_file="${evidence_root}/release-app-oci-inspect.json"
  local gateway_file="${evidence_root}/release-gateway-oci-inspect.json"
  local source_file="${evidence_root}/release-pipeline-source.json"
  local manifest_file="${evidence_root}/acceptance-release-readbacks.json"

  require_root_owned_directory "$evidence_root"
  for artifact in "$ci_file" "$deploy_file" "$runtime_file" "$app_file" "$gateway_file" "$source_file" "$manifest_file"; do
    require_root_owned_file "$artifact"
  done
  jq -e --arg revision "$revision" --arg backendCiRunId "$backend_ci_run_id" \
    --arg publishRunId "$publish_run_id" --arg deployRunId "$deploy_run_id" \
    --arg appDigest "$app_digest" --arg gatewayDigest "$gateway_digest" '
    .schemaVersion == 2 and .headSha == $revision
    and .backendCi == {workflow:"Backend CI",conclusion:"success",headSha:$revision,runId:$backendCiRunId}
    and .publish == {workflow:"Publish GHCR images",conclusion:"success",headSha:$revision,runId:$publishRunId}
    and .deploy == {workflow:"Deploy Arnall",headSha:$revision,runId:$deployRunId}
    and .images == {appDigest:$appDigest,gatewayDigest:$gatewayDigest}
  ' "$source_file" >/dev/null || fail "existing release pipeline source does not match the requested retry"
  jq -e --arg revision "$revision" --arg backendCiRunId "$backend_ci_run_id" \
    --arg publishRunId "$publish_run_id" --arg deployRunId "$deploy_run_id" \
    --arg appDigest "$app_digest" --arg gatewayDigest "$gateway_digest" '
    .schemaVersion == 1 and .kind == "aibrain-release-ci-readback" and .source == "ci"
    and .candidateSha == $revision and .ciSha == $revision
    and .backendCi == {runId:$backendCiRunId,headSha:$revision}
    and .publish == {runId:$publishRunId,headSha:$revision}
    and .deploy == {runId:$deployRunId,headSha:$revision}
    and .appOciDigest == $appDigest and .gatewayOciDigest == $gatewayDigest
    and (.capturedAt | type == "string") and (.provenance.kind == "file")
    and (.provenance.sha256 | test("^[0-9a-f]{64}$"))
  ' "$ci_file" >/dev/null || fail "existing CI readback does not match the requested retry"
  captured_at="$(jq -er '.capturedAt' "$ci_file")" || fail "existing collector capture time is invalid"
  [[ "$captured_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || fail "existing collector capture time is invalid"
  jq -e --arg revision "$revision" --arg capturedAt "$captured_at" '
    .schemaVersion == 1 and .kind == "aibrain-release-deploy-state-readback" and .source == "deploy-state"
    and .ciSha == $revision and .deploySha == $revision and .capturedAt == $capturedAt
    and (.appOciDigest | test("^sha256:[0-9a-f]{64}$"))
    and (.gatewayOciDigest | test("^sha256:[0-9a-f]{64}$"))
  ' "$deploy_file" >/dev/null || fail "existing deploy-state readback does not match the requested retry"
  jq -e --arg revision "$revision" --arg capturedAt "$captured_at" '
    .schemaVersion == 1 and .kind == "aibrain-release-runtime-readback" and .source == "runtime"
    and .deploySha == $revision and .runtimeSha == $revision and .appOciRevision == $revision
    and .gatewayOciRevision == $revision and .capturedAt == $capturedAt
  ' "$runtime_file" >/dev/null || fail "existing runtime readback does not match the requested retry"
  jq -e --arg revision "$revision" --arg capturedAt "$captured_at" --arg digest "$(jq -er '.appOciDigest' "$deploy_file")" '
    .schemaVersion == 1 and .kind == "aibrain-release-oci-inspect" and .source == "oci-inspect"
    and .component == "app" and .revision == $revision and .digest == $digest and .capturedAt == $capturedAt
  ' "$app_file" >/dev/null || fail "existing app OCI readback does not match the requested retry"
  jq -e --arg revision "$revision" --arg capturedAt "$captured_at" --arg digest "$(jq -er '.gatewayOciDigest' "$deploy_file")" '
    .schemaVersion == 1 and .kind == "aibrain-release-oci-inspect" and .source == "oci-inspect"
    and .component == "gateway" and .revision == $revision and .digest == $digest and .capturedAt == $capturedAt
  ' "$gateway_file" >/dev/null || fail "existing gateway OCI readback does not match the requested retry"
  expected_manifest="$(jq -cn --arg releaseSha "$revision" --arg backendCiRunId "$backend_ci_run_id" \
    --arg publishRunId "$publish_run_id" --arg deployRunId "$deploy_run_id" \
    --arg appOciDigest "$app_digest" --arg gatewayOciDigest "$gateway_digest" --arg capturedAt "$captured_at" \
    --arg ciHash "$(sha256sum "$ci_file" | awk '{print $1}')" \
    --arg deployHash "$(sha256sum "$deploy_file" | awk '{print $1}')" \
    --arg runtimeHash "$(sha256sum "$runtime_file" | awk '{print $1}')" \
    --arg appHash "$(sha256sum "$app_file" | awk '{print $1}')" \
    --arg gatewayHash "$(sha256sum "$gateway_file" | awk '{print $1}')" \
    '{schemaVersion:2,releaseSha:$releaseSha,backendCiRunId:$backendCiRunId,publishRunId:$publishRunId,
      deployRunId:$deployRunId,appOciDigest:$appOciDigest,gatewayOciDigest:$gatewayOciDigest,capturedAt:$capturedAt,evidence:[
      {kind:"release",route:"release:ci-readback",artifactPath:"release-ci-readback.json",sha256:$ciHash},
      {kind:"release",route:"release:deploy-state",artifactPath:"release-deploy-state.json",sha256:$deployHash},
      {kind:"release",route:"release:runtime-readback",artifactPath:"release-runtime-readback.json",sha256:$runtimeHash},
      {kind:"release",route:"release:app-oci-inspect",artifactPath:"release-app-oci-inspect.json",sha256:$appHash},
      {kind:"release",route:"release:gateway-oci-inspect",artifactPath:"release-gateway-oci-inspect.json",sha256:$gatewayHash}
    ]}')"
  actual_manifest="$(jq -cS . "$manifest_file")" || fail "existing acceptance manifest is invalid"
  [[ "$actual_manifest" == "$(jq -cS . <<<"$expected_manifest")" ]] || fail "existing acceptance evidence does not match the requested retry"
}

collect_release_readbacks() {
  local revision="$1" backend_ci_run_id="$2" publish_run_id="$3" deploy_run_id="$4"
  local app_digest="$5" gateway_digest="$6"
  local compose_file="${STATE_FILE}.active.compose.yaml"
  local evidence_parent="${CONFIG_DIR}/acceptance"
  local evidence_root="${evidence_parent}/${revision}"
  local app_container gateway_container captured_at
  readback_evidence_parent="$evidence_parent"
  readback_revision="$revision"

  [[ -f "$STATE_FILE" ]] || fail "release state is unavailable"
  require_root_owned_file "$STATE_FILE"
  require_root_owned_file "$ACTIVE_ENV"
  require_root_owned_file "$compose_file"
  require_root_owned_file "${OPS_ROOT}/collect-release-readbacks.mjs"
  jq -e --arg revision "$revision" '.schemaVersion == 3 and .current.revision == $revision' "$STATE_FILE" >/dev/null \
    || fail "release state does not match the requested candidate"
  require_noninteractive_browser_policy "$compose_file"
  runtime_noninteractive_browser_policy_is_active "$compose_file" \
    || fail "release readback found interactive browser approvals enabled"
  [[ "$backend_ci_run_id" =~ ^[0-9]{6,20}$ ]] || fail "Backend CI run ID is invalid"
  [[ "$publish_run_id" =~ ^[0-9]{6,20}$ ]] || fail "Publish run ID is invalid"
  [[ "$deploy_run_id" =~ ^[0-9]{6,20}$ ]] || fail "Deploy run ID is invalid"
  [[ "$backend_ci_run_id" != "$publish_run_id" && "$backend_ci_run_id" != "$deploy_run_id" \
    && "$publish_run_id" != "$deploy_run_id" ]] || fail "release workflow run IDs must be distinct"
  [[ "$app_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "published application digest is invalid"
  [[ "$gateway_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "published gateway digest is invalid"
  jq -e --arg appDigest "$app_digest" --arg gatewayDigest "$gateway_digest" '
    .current.image | endswith("@" + $appDigest)
  ' "$STATE_FILE" >/dev/null || fail "published application digest does not match release state"
  jq -e --arg gatewayDigest "$gateway_digest" '
    .current.egressImage | endswith("@" + $gatewayDigest)
  ' "$STATE_FILE" >/dev/null || fail "published gateway digest does not match release state"

  install -d -m 0700 -o root -g root "$evidence_parent"
  if [[ -e "$evidence_root" ]]; then
    validate_existing_release_readbacks "$revision" "$backend_ci_run_id" "$publish_run_id" "$deploy_run_id" \
      "$app_digest" "$gateway_digest" "$evidence_root"
    printf 'ARNALL_READBACKS_ALREADY_COLLECTED revision=%s backend_ci_run_id=%s publish_run_id=%s deploy_run_id=%s\n' \
      "$revision" "$backend_ci_run_id" "$publish_run_id" "$deploy_run_id"
    return
  fi

  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/live >/dev/null
  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/ready >/dev/null
  app_container="$(docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" ps -q app)"
  gateway_container="$(docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" ps -q ingress-gateway)"
  [[ "$app_container" =~ ^[a-f0-9]{12,64}$ ]] || fail "application container is unavailable"
  [[ "$gateway_container" =~ ^[a-f0-9]{12,64}$ ]] || fail "gateway container is unavailable"

  umask 077
  readback_staging="$(mktemp -d "${evidence_parent}/.${revision}.XXXXXX")"
  trap cleanup_readback_staging EXIT
  chmod 0700 "$readback_staging"
  require_root_owned_directory "$readback_staging"
  jq -n --arg revision "$revision" --arg backendCiRunId "$backend_ci_run_id" \
    --arg publishRunId "$publish_run_id" --arg deployRunId "$deploy_run_id" \
    --arg appDigest "$app_digest" --arg gatewayDigest "$gateway_digest" \
    '{schemaVersion:2,headSha:$revision,
      backendCi:{workflow:"Backend CI",conclusion:"success",headSha:$revision,runId:$backendCiRunId},
      publish:{workflow:"Publish GHCR images",conclusion:"success",headSha:$revision,runId:$publishRunId},
      deploy:{workflow:"Deploy Arnall",headSha:$revision,runId:$deployRunId},
      images:{appDigest:$appDigest,gatewayDigest:$gatewayDigest}}' \
    > "${readback_staging}/release-pipeline-source.json"
  chmod 0600 "${readback_staging}/release-pipeline-source.json"
  node "${OPS_ROOT}/collect-release-readbacks.mjs" \
    --output-root "$readback_staging" \
    --candidate-sha "$revision" \
    --pipeline-source "${readback_staging}/release-pipeline-source.json" \
    --release-state "$STATE_FILE" \
    --docker-bin /usr/bin/docker \
    --app-container "$app_container" \
    --gateway-container "$gateway_container"
  for artifact in release-ci-readback.json release-deploy-state.json release-runtime-readback.json release-app-oci-inspect.json release-gateway-oci-inspect.json; do
    require_root_owned_file "${readback_staging}/${artifact}"
  done
  captured_at="$(jq -r '.capturedAt' "${readback_staging}/release-ci-readback.json")"
  [[ "$captured_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || fail "collector capture time is invalid"
  jq -n --arg releaseSha "$revision" --arg backendCiRunId "$backend_ci_run_id" \
    --arg publishRunId "$publish_run_id" --arg deployRunId "$deploy_run_id" \
    --arg appOciDigest "$app_digest" --arg gatewayOciDigest "$gateway_digest" --arg capturedAt "$captured_at" \
    --arg ciHash "$(sha256sum "${readback_staging}/release-ci-readback.json" | awk '{print $1}')" \
    --arg deployHash "$(sha256sum "${readback_staging}/release-deploy-state.json" | awk '{print $1}')" \
    --arg runtimeHash "$(sha256sum "${readback_staging}/release-runtime-readback.json" | awk '{print $1}')" \
    --arg appHash "$(sha256sum "${readback_staging}/release-app-oci-inspect.json" | awk '{print $1}')" \
    --arg gatewayHash "$(sha256sum "${readback_staging}/release-gateway-oci-inspect.json" | awk '{print $1}')" \
    '{schemaVersion:2,releaseSha:$releaseSha,backendCiRunId:$backendCiRunId,publishRunId:$publishRunId,
      deployRunId:$deployRunId,appOciDigest:$appOciDigest,gatewayOciDigest:$gatewayOciDigest,capturedAt:$capturedAt,evidence:[
      {kind:"release",route:"release:ci-readback",artifactPath:"release-ci-readback.json",sha256:$ciHash},
      {kind:"release",route:"release:deploy-state",artifactPath:"release-deploy-state.json",sha256:$deployHash},
      {kind:"release",route:"release:runtime-readback",artifactPath:"release-runtime-readback.json",sha256:$runtimeHash},
      {kind:"release",route:"release:app-oci-inspect",artifactPath:"release-app-oci-inspect.json",sha256:$appHash},
      {kind:"release",route:"release:gateway-oci-inspect",artifactPath:"release-gateway-oci-inspect.json",sha256:$gatewayHash}
    ]}' > "${readback_staging}/acceptance-release-readbacks.json"
  chmod 0600 "${readback_staging}/acceptance-release-readbacks.json"
  require_root_owned_file "${readback_staging}/acceptance-release-readbacks.json"
  mv "$readback_staging" "$evidence_root"
  readback_staging=""
  readback_evidence_parent=""
  readback_revision=""
  trap - EXIT
}

bootstrap_workspace_admin() {
  local user_id="$1"
  local compose_file="${STATE_FILE}.active.compose.yaml"
  local runtime_env="${CONFIG_DIR}/runtime.env"
  local app_container temporary

  [[ "$user_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || fail "workspace bootstrap user id is invalid"
  require_root_owned_file "$ACTIVE_ENV"
  require_root_owned_file "$compose_file"
  require_root_owned_file "$runtime_env"
  grep -qx "AIBRAIN_RUNTIME_ENV_FILE=${runtime_env}" "$ACTIVE_ENV" \
    || fail "active runtime env is outside the Arnall configuration boundary"

  app_container="$(docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" ps -q app)"
  [[ "$app_container" =~ ^[a-f0-9]{12,64}$ ]] || fail "application container is unavailable"
  docker exec "$app_container" test -f "/var/lib/aibrain/data/users/${user_id}/user.json" \
    || fail "workspace bootstrap user is not provisioned"
  if docker exec "$app_container" test -e /var/lib/aibrain/data/workspace-admin/state.json; then
    printf 'ARNALL_ADMIN_BOOTSTRAP_ALREADY_INITIALIZED\n'
    return
  fi

  umask 077
  temporary="$(mktemp "${runtime_env}.pending.XXXXXX")"
  awk -v user_id="$user_id" '
    BEGIN { replaced = 0 }
    /^AIBRAIN_ADMIN_USER_IDS=/ { print "AIBRAIN_ADMIN_USER_IDS=" user_id; replaced = 1; next }
    { print }
    END { if (!replaced) print "AIBRAIN_ADMIN_USER_IDS=" user_id }
  ' "$runtime_env" > "$temporary"
  chmod 0600 "$temporary"
  chown root:root "$temporary"
  mv -f "$temporary" "$runtime_env"

  docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" up -d --no-deps --force-recreate app >/dev/null
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 5 https://arnall.graphikai.com/api/health/ready >/dev/null 2>&1; then
      printf 'ARNALL_ADMIN_BOOTSTRAP_READY user_id=%s\n' "$user_id"
      return
    fi
    sleep 2
  done
  fail "application did not become ready after workspace admin bootstrap"
}

main() {
  [[ "$(id -u)" == "0" ]] || fail "deployment gateway must run as root"
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy-ghcr\ ([0-9a-f]{40})\ (ghcr\.io/arnautxu/aibrain@sha256:[0-9a-f]{64})\ (ghcr\.io/arnautxu/aibrain-egress@sha256:[0-9a-f]{64})\ ([A-Za-z0-9][A-Za-z0-9-]{0,38})$ ]]; then
    deploy_ghcr_release "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
    return
  fi
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^collect-readbacks\ ([0-9a-f]{40})\ ([0-9]{6,20})\ ([0-9]{6,20})\ ([0-9]{6,20})\ (sha256:[0-9a-f]{64})\ (sha256:[0-9a-f]{64})$ ]]; then
    collect_release_readbacks "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" \
      "${BASH_REMATCH[4]}" "${BASH_REMATCH[5]}" "${BASH_REMATCH[6]}"
    return
  fi
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^bootstrap-admin\ ([0-9a-f-]{36})$ ]]; then
    bootstrap_workspace_admin "${BASH_REMATCH[1]}"
    return
  fi
  fail "unsupported gateway command"
}

main "$@"
