#!/usr/bin/env bash

set -euo pipefail

readonly INSTALLATION_ID="company-qa"
readonly COMPOSE_PROJECT="aibrain-company-qa"
readonly RELEASE_ROOT="/opt/aibrain-company-qa"
readonly OPS_ROOT="${RELEASE_ROOT}/ghcr-ops"
readonly CONFIG_DIR="/etc/aibrain/company-qa"
readonly ACTIVE_ENV="${CONFIG_DIR}/compose.env"
readonly AUTOMATION_WORKER_ENABLED="false"
readonly ACTIVE_CONFIG="${CONFIG_DIR}/installation.json"
readonly STATE_FILE="${CONFIG_DIR}/release-state.json"
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

require_release_readback_runtime() {
  node --input-type=module --eval '
    const major = Number.parseInt(process.versions.node.split(".")[0], 10);
    if (!Number.isInteger(major) || major < 22) process.exit(64);
  ' >/dev/null 2>&1 || fail "host Node runtime cannot execute the release readback collector"
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

cleanup_ghcr_credentials() {
  local status="$?"
  if [[ -n "${ghcr_docker_config:-}" && -d "$ghcr_docker_config" && ! -L "$ghcr_docker_config" ]]; then
    rm -rf --one-file-system -- "$ghcr_docker_config"
  fi
  exit "$status"
}

pull_ghcr_images() {
  local app_image="$1" egress_image="$2" ghcr_user="$3" ghcr_token=""
  [[ "$app_image" =~ ^${GHCR_APP_REPOSITORY}@sha256:[0-9a-f]{64}$ ]] || fail "application image is not the approved GHCR repository and digest"
  [[ "$egress_image" =~ ^${GHCR_EGRESS_REPOSITORY}@sha256:[0-9a-f]{64}$ ]] || fail "egress image is not the approved GHCR repository and digest"
  [[ "$ghcr_user" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || fail "GHCR username is invalid"
  IFS= read -r ghcr_token || [[ -n "$ghcr_token" ]] || fail "GHCR pull token was not supplied"
  [[ -n "$ghcr_token" ]] || fail "GHCR pull token was empty"
  umask 077
  ghcr_docker_config="$(mktemp -d "${RELEASE_ROOT}/.ghcr-docker.XXXXXX")"
  trap cleanup_ghcr_credentials EXIT
  printf '%s' "$ghcr_token" | docker --config "$ghcr_docker_config" login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null
  unset ghcr_token
  docker --config "$ghcr_docker_config" pull "$app_image" >/dev/null
  docker --config "$ghcr_docker_config" pull "$egress_image" >/dev/null
}

remove_unused_aibrain_image() {
  local image="$1" image_id label reference
  [[ "$image" =~ ^(127\.0\.0\.1:5000/aibrain-company-qa|127\.0\.0\.1:5000/aibrain-company-qa-egress|${GHCR_APP_REPOSITORY}|${GHCR_EGRESS_REPOSITORY})@sha256:[0-9a-f]{64}$ ]] || return 0
  image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 0
  [[ -z "$(docker ps --all --quiet --filter "ancestor=${image_id}")" ]] || return 0
  label="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.title"}}' "$image_id")"
  [[ "$label" == "AiBrain Company Brain" || "$label" == "AiBrain Egress Gateway" ]] || fail "refusing to remove a non-AiBrain image"
  while IFS= read -r reference; do
    [[ -n "$reference" && "$reference" != "<none>:<none>" ]] || continue
    [[ "$reference" == 127.0.0.1:5000/aibrain-company-qa:* || "$reference" == 127.0.0.1:5000/aibrain-company-qa-egress:* || "$reference" == ${GHCR_APP_REPOSITORY}:* || "$reference" == ${GHCR_EGRESS_REPOSITORY}:* ]] \
      || fail "refusing to remove an image shared with another repository"
    docker image rm "$reference" >/dev/null
  done < <(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$image_id")
}

cleanup_previous_aibrain_images() {
  local image
  [[ -f "$STATE_FILE" ]] || return 0
  while IFS= read -r image; do
    remove_unused_aibrain_image "$image"
  done < <(jq -r '.previous.image?, .previous.egressImage? // empty' "$STATE_FILE")
}

deploy_ghcr_release() {
  local revision="$1" app_image="$2" egress_image="$3" ghcr_user="$4"
  local short_revision="${revision:0:7}"
  local target_env="${CONFIG_DIR}/compose.env.target-${short_revision}"
  local compose_file="${STATE_FILE}.active.compose.yaml"
  local manager_args

  umask 077
  install -d -m 0700 -o root -g root "$RELEASE_ROOT" "$CONFIG_DIR"
  exec 9>"${RELEASE_ROOT}/deploy.lock"
  flock --exclusive --nonblock 9 || fail "another Arnall deployment is running"
  require_root_owned_file "$ACTIVE_ENV"
  require_root_owned_file "$ACTIVE_CONFIG"
  require_root_owned_file "$STATE_FILE"
  require_root_owned_file "$compose_file"
  require_root_owned_file "${OPS_ROOT}/manage-release.mjs"
  require_root_owned_file "${OPS_ROOT}/collect-release-readbacks.mjs"
  grep -qx "AIBRAIN_INSTALLATION_ID=${INSTALLATION_ID}" "$ACTIVE_ENV" || fail "active env belongs to another installation"
  grep -qx "AIBRAIN_COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT}" "$ACTIVE_ENV" || fail "active env targets another Compose project"
  require_release_readback_runtime

  if jq -e --arg revision "$revision" '.current.revision == $revision' "$STATE_FILE" >/dev/null; then
    printf 'ARNALL_DEPLOY_ALREADY_CURRENT revision=%s\n' "$revision"
    return
  fi

  pull_ghcr_images "$app_image" "$egress_image" "$ghcr_user"
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
    --installation-config "$ACTIVE_CONFIG"
    --state-file "$STATE_FILE"
    --health-timeout-ms 240000
    --docker-command-timeout-ms 240000
  )

  docker compose --env-file "$ACTIVE_ENV" -f "$compose_file" up -d --no-deps alert-dispatcher
  AIBRAIN_AUTOMATION_WORKER_ENABLED="$AUTOMATION_WORKER_ENABLED" \
    node "${OPS_ROOT}/manage-release.mjs" "${manager_args[@]}"
  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/live >/dev/null
  curl --fail --silent --show-error --max-time 20 https://arnall.graphikai.com/api/health/ready >/dev/null
  cleanup_previous_aibrain_images

  jq -n --arg revision "$revision" --arg image "$app_image" --arg egressImage "$egress_image" \
    '{schemaVersion:1,installationId:"company-qa",revision:$revision,image:$image,egressImage:$egressImage,deployedAt:(now|todateiso8601)}' \
    > "${CONFIG_DIR}/last-deployment.json.pending"
  chmod 0600 "${CONFIG_DIR}/last-deployment.json.pending"
  mv -f "${CONFIG_DIR}/last-deployment.json.pending" "${CONFIG_DIR}/last-deployment.json"
  printf 'ARNALL_DEPLOY_OK revision=%s\n' "$revision"
}

validate_existing_release_readbacks() {
  local revision="$1" run_id="$2" evidence_root="$3"
  local captured_at expected_manifest actual_manifest
  local ci_file="${evidence_root}/release-ci-readback.json"
  local deploy_file="${evidence_root}/release-deploy-state.json"
  local runtime_file="${evidence_root}/release-runtime-readback.json"
  local app_file="${evidence_root}/release-app-oci-inspect.json"
  local gateway_file="${evidence_root}/release-gateway-oci-inspect.json"
  local source_file="${evidence_root}/backend-ci-source.json"
  local manifest_file="${evidence_root}/acceptance-release-readbacks.json"

  require_root_owned_directory "$evidence_root"
  for artifact in "$ci_file" "$deploy_file" "$runtime_file" "$app_file" "$gateway_file" "$source_file" "$manifest_file"; do
    require_root_owned_file "$artifact"
  done
  jq -e --arg revision "$revision" --arg runId "$run_id" '
    .schemaVersion == 1 and .workflow == "Backend CI" and .conclusion == "success"
    and .headSha == $revision and .runId == $runId
  ' "$source_file" >/dev/null || fail "existing Backend CI source does not match the requested retry"
  jq -e --arg revision "$revision" '
    .schemaVersion == 1 and .kind == "aibrain-release-ci-readback" and .source == "ci"
    and .candidateSha == $revision and .ciSha == $revision
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
  expected_manifest="$(jq -cn --arg releaseSha "$revision" --arg runId "$run_id" --arg capturedAt "$captured_at" \
    --arg ciHash "$(sha256sum "$ci_file" | awk '{print $1}')" \
    --arg deployHash "$(sha256sum "$deploy_file" | awk '{print $1}')" \
    --arg runtimeHash "$(sha256sum "$runtime_file" | awk '{print $1}')" \
    --arg appHash "$(sha256sum "$app_file" | awk '{print $1}')" \
    --arg gatewayHash "$(sha256sum "$gateway_file" | awk '{print $1}')" \
    '{schemaVersion:1,releaseSha:$releaseSha,ciRunId:$runId,capturedAt:$capturedAt,evidence:[
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
  local revision="$1" run_id="$2"
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
  [[ "$run_id" =~ ^[0-9]{6,20}$ ]] || fail "Backend CI run ID is invalid"

  install -d -m 0700 -o root -g root "$evidence_parent"
  if [[ -e "$evidence_root" ]]; then
    validate_existing_release_readbacks "$revision" "$run_id" "$evidence_root"
    printf 'ARNALL_READBACKS_ALREADY_COLLECTED revision=%s run_id=%s\n' "$revision" "$run_id"
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
  jq -n --arg revision "$revision" --arg runId "$run_id" \
    '{schemaVersion:1,workflow:"Backend CI",conclusion:"success",headSha:$revision,runId:$runId}' \
    > "${readback_staging}/backend-ci-source.json"
  chmod 0600 "${readback_staging}/backend-ci-source.json"
  node "${OPS_ROOT}/collect-release-readbacks.mjs" \
    --output-root "$readback_staging" \
    --candidate-sha "$revision" \
    --ci-source "${readback_staging}/backend-ci-source.json" \
    --release-state "$STATE_FILE" \
    --docker-bin /usr/bin/docker \
    --app-container "$app_container" \
    --gateway-container "$gateway_container"
  for artifact in release-ci-readback.json release-deploy-state.json release-runtime-readback.json release-app-oci-inspect.json release-gateway-oci-inspect.json; do
    require_root_owned_file "${readback_staging}/${artifact}"
  done
  captured_at="$(jq -r '.capturedAt' "${readback_staging}/release-ci-readback.json")"
  [[ "$captured_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || fail "collector capture time is invalid"
  jq -n --arg releaseSha "$revision" --arg runId "$run_id" --arg capturedAt "$captured_at" \
    --arg ciHash "$(sha256sum "${readback_staging}/release-ci-readback.json" | awk '{print $1}')" \
    --arg deployHash "$(sha256sum "${readback_staging}/release-deploy-state.json" | awk '{print $1}')" \
    --arg runtimeHash "$(sha256sum "${readback_staging}/release-runtime-readback.json" | awk '{print $1}')" \
    --arg appHash "$(sha256sum "${readback_staging}/release-app-oci-inspect.json" | awk '{print $1}')" \
    --arg gatewayHash "$(sha256sum "${readback_staging}/release-gateway-oci-inspect.json" | awk '{print $1}')" \
    '{schemaVersion:1,releaseSha:$releaseSha,ciRunId:$runId,capturedAt:$capturedAt,evidence:[
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
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^collect-readbacks\ ([0-9a-f]{40})\ ([0-9]{6,20})$ ]]; then
    collect_release_readbacks "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return
  fi
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^bootstrap-admin\ ([0-9a-f-]{36})$ ]]; then
    bootstrap_workspace_admin "${BASH_REMATCH[1]}"
    return
  fi
  fail "unsupported gateway command"
}

main "$@"
