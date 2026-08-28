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

require_root_owned_directory() {
  local directory="$1"
  [[ -d "$directory" && ! -L "$directory" ]] || fail "missing controlled directory: ${directory}"
  [[ "$(stat -c '%u' "$directory")" == "0" ]] || fail "directory is not root-owned: ${directory}"
  (( (8#$(stat -c '%a' "$directory") & 8#077) == 0 )) || fail "directory is accessible by non-root users: ${directory}"
}

require_release_readback_runtime() {
  node --experimental-strip-types --input-type=module --eval '
    const major = Number.parseInt(process.versions.node.split(".")[0], 10);
    if (!Number.isInteger(major) || major < 22) process.exit(64);
  ' >/dev/null 2>&1 || fail "host Node runtime cannot execute the release readback collector"
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

remove_new_dangling_images() {
  local before="$1" after="$2" image_id
  while IFS= read -r image_id; do
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
    [[ -z "$(docker ps --all --quiet --filter "ancestor=${image_id}")" ]] || continue
    docker image rm "$image_id" >/dev/null 2>&1 || true
  done < <(new_dangling_images "$before" "$after")
}

sync_company_context() {
  local source="$1" file temporary
  install -d -m 0700 -o root -g root "$CONTEXT_ROOT"
  chown 10001:10001 "$CONTEXT_ROOT"
  while IFS= read -r -d '' file; do
    temporary="${CONTEXT_ROOT}/.$(basename "$file").pending-$$"
    install -m 0400 -o root -g root "$file" "$temporary"
    chown 10001:10001 "$temporary"
    mv -f "$temporary" "${CONTEXT_ROOT}/$(basename "$file")"
  done < <(find "$source" -maxdepth 1 -type f -name '*.md' -print0)
}

deploy_release() {
  local revision="$1"
  local short_revision="${revision:0:7}"
  local release_dir="${RELEASES_DIR}/${revision}"
  local incoming_dir="${RELEASE_ROOT}/incoming"
  local archive="${incoming_dir}/${revision}.$$.tar"
  local target_env="${CONFIG_DIR}/compose.env.target-${short_revision}"
  local target_config="${CONFIG_DIR}/installation.target-${short_revision}.json"
  local compose_file current_compose current_revision current_short
  local app_tag egress_tag app_image egress_image free_bytes
  local dangling_before="" dangling_after="" manager_args
  local release_prepared=0

  cleanup_incomplete_release() {
    local status="$?"

    set +e
    if (( status != 0 )) && [[ -n "$dangling_before" && -f "$dangling_before" ]]; then
      remove_new_dangling_images "$dangling_before" "$dangling_after"
    fi
    rm -f "$archive" "$target_env" "$target_config"
    [[ -z "$dangling_before" ]] || rm -f "$dangling_before"
    [[ -z "$dangling_after" ]] || rm -f "$dangling_after"

    if (( status != 0 && release_prepared == 1 )); then
      if [[ ! -f "$STATE_FILE" ]] || ! jq -e --arg revision "$revision" '.current.revision == $revision' "$STATE_FILE" >/dev/null; then
        rm -rf --one-file-system -- "$release_dir"
      fi
    fi
    exit "$status"
  }

  umask 077
  install -d -m 0700 -o root -g root "$RELEASE_ROOT" "$RELEASES_DIR" "$incoming_dir" "$CONFIG_DIR"
  exec 9>"${RELEASE_ROOT}/deploy.lock"
  flock --exclusive --nonblock 9 || fail "another Arnall deployment is running"

  require_root_owned_file "$ACTIVE_ENV"
  require_root_owned_file "$ACTIVE_CONFIG"
  grep -qx "AIBRAIN_INSTALLATION_ID=${INSTALLATION_ID}" "$ACTIVE_ENV" || fail "active env belongs to another installation"
  grep -qx "AIBRAIN_COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT}" "$ACTIVE_ENV" || fail "active env targets another Compose project"
  require_release_readback_runtime
  docker buildx version >/dev/null 2>&1 || fail "Docker Buildx is required before receiving a release archive"

  if [[ -f "$STATE_FILE" ]] && jq -e --arg revision "$revision" '.current.revision == $revision' "$STATE_FILE" >/dev/null; then
    printf 'ARNALL_DEPLOY_ALREADY_CURRENT revision=%s\n' "$revision"
    exit 0
  fi

  if [[ -e "$release_dir" ]]; then
    [[ -d "$release_dir" && ! -L "$release_dir" ]] || fail "non-current release path is not a directory"
    rm -rf --one-file-system -- "$release_dir"
  fi

  free_bytes="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
  [[ "$free_bytes" =~ ^[0-9]+$ && "$free_bytes" -ge "$MIN_FREE_BYTES" ]] || fail "insufficient free disk for a bounded image build"

  trap cleanup_incomplete_release EXIT

  dd if=/dev/stdin of="$archive" bs=1M count=65 iflag=fullblock status=none
  validate_archive "$archive"
  release_prepared=1
  install -d -m 0700 -o root -g root "$release_dir"
  tar --extract --file="$archive" --directory="$release_dir" --no-same-owner
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

  install -d -m 0755 -o root -g root "${RELEASE_ROOT}/node_modules"
  if [[ ! -f "${RELEASE_ROOT}/node_modules/js-yaml/package.json" ]]; then
    npm install --prefix "$RELEASE_ROOT" --no-save --ignore-scripts --omit=dev js-yaml@4.3.2
  fi

  dangling_before="$(mktemp "${RELEASE_ROOT}/dangling-before.XXXXXX")"
  dangling_after="$(mktemp "${RELEASE_ROOT}/dangling-after.XXXXXX")"
  docker image ls --filter dangling=true --quiet --no-trunc | sort -u > "$dangling_before"

  app_tag="${APP_REPOSITORY}:${revision}"
  egress_tag="${EGRESS_REPOSITORY}:${revision}"
  DOCKER_BUILDKIT=1 docker build --pull --target runtime --build-arg "AIBRAIN_REVISION=${revision}" --tag "$app_tag" "$release_dir"
  DOCKER_BUILDKIT=1 docker build --pull --target egress-gateway --build-arg "AIBRAIN_REVISION=${revision}" --tag "$egress_tag" "$release_dir"
  docker push "$app_tag"
  docker push "$egress_tag"
  app_image="$(docker image inspect --format '{{index .RepoDigests 0}}' "$app_tag")"
  egress_image="$(docker image inspect --format '{{index .RepoDigests 0}}' "$egress_tag")"
  [[ "$app_image" =~ @sha256:[0-9a-f]{64}$ ]] || fail "application image digest is unavailable"
  [[ "$egress_image" =~ @sha256:[0-9a-f]{64}$ ]] || fail "egress image digest is unavailable"
  # Keep compatibility cleanup for hosts upgrading from the legacy builder.
  # BuildKit avoids materializing one full dangling image per Dockerfile step.
  remove_new_dangling_images "$dangling_before" "$dangling_after"

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

  remove_new_dangling_images "$dangling_before" "$dangling_after"
  rm -f "$dangling_before" "$dangling_after"

  bash -n "${release_dir}/infra/hetzner/app/deploy-arnall-main.sh"
  install -m 0700 -o root -g root \
    "${release_dir}/infra/hetzner/app/deploy-arnall-main.sh" \
    /usr/local/sbin/aibrain-deploy-gateway

  jq -n --arg revision "$revision" --arg image "$app_image" --arg egressImage "$egress_image" \
    '{schemaVersion:1,installationId:"company-qa",revision:$revision,image:$image,egressImage:$egressImage,deployedAt:(now|todateiso8601)}' \
    > "${CONFIG_DIR}/last-deployment.json.pending"
  chmod 0600 "${CONFIG_DIR}/last-deployment.json.pending"
  mv -f "${CONFIG_DIR}/last-deployment.json.pending" "${CONFIG_DIR}/last-deployment.json"
  trap - EXIT
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
  local release_dir="${RELEASES_DIR}/${revision}"
  local compose_file="${STATE_FILE}.active.compose.yaml"
  local evidence_parent="${CONFIG_DIR}/acceptance"
  local evidence_root="${evidence_parent}/${revision}"
  local staging="" app_container gateway_container captured_at

  cleanup_readback_staging() {
    local status="$?"
    set +e
    if [[ -n "$staging" && -d "$staging" && ! -L "$staging" && "$staging" == "${evidence_parent}/.${revision}."* ]]; then
      rm -rf --one-file-system -- "$staging"
    fi
    exit "$status"
  }

  [[ -f "$STATE_FILE" ]] || fail "release state is unavailable"
  require_root_owned_file "$STATE_FILE"
  require_root_owned_file "$ACTIVE_ENV"
  require_root_owned_file "$compose_file"
  [[ -d "$release_dir" && ! -L "$release_dir" ]] || fail "candidate release directory is unavailable"
  [[ -f "${release_dir}/scripts/collect-release-readbacks.ts" ]] || fail "candidate release has no readback collector"
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
  staging="$(mktemp -d "${evidence_parent}/.${revision}.XXXXXX")"
  trap cleanup_readback_staging EXIT
  chmod 0700 "$staging"
  require_root_owned_directory "$staging"
  jq -n --arg revision "$revision" --arg runId "$run_id" \
    '{schemaVersion:1,workflow:"Backend CI",conclusion:"success",headSha:$revision,runId:$runId}' \
    > "${staging}/backend-ci-source.json"
  chmod 0600 "${staging}/backend-ci-source.json"
  node --experimental-strip-types "${release_dir}/scripts/collect-release-readbacks.ts" \
    --output-root "$staging" \
    --candidate-sha "$revision" \
    --ci-source "${staging}/backend-ci-source.json" \
    --release-state "$STATE_FILE" \
    --docker-bin /usr/bin/docker \
    --app-container "$app_container" \
    --gateway-container "$gateway_container"
  for artifact in release-ci-readback.json release-deploy-state.json release-runtime-readback.json release-app-oci-inspect.json release-gateway-oci-inspect.json; do
    require_root_owned_file "${staging}/${artifact}"
  done
  captured_at="$(jq -r '.capturedAt' "${staging}/release-ci-readback.json")"
  [[ "$captured_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || fail "collector capture time is invalid"
  jq -n --arg releaseSha "$revision" --arg runId "$run_id" --arg capturedAt "$captured_at" \
    --arg ciHash "$(sha256sum "${staging}/release-ci-readback.json" | awk '{print $1}')" \
    --arg deployHash "$(sha256sum "${staging}/release-deploy-state.json" | awk '{print $1}')" \
    --arg runtimeHash "$(sha256sum "${staging}/release-runtime-readback.json" | awk '{print $1}')" \
    --arg appHash "$(sha256sum "${staging}/release-app-oci-inspect.json" | awk '{print $1}')" \
    --arg gatewayHash "$(sha256sum "${staging}/release-gateway-oci-inspect.json" | awk '{print $1}')" \
    '{schemaVersion:1,releaseSha:$releaseSha,ciRunId:$runId,capturedAt:$capturedAt,evidence:[
      {kind:"release",route:"release:ci-readback",artifactPath:"release-ci-readback.json",sha256:$ciHash},
      {kind:"release",route:"release:deploy-state",artifactPath:"release-deploy-state.json",sha256:$deployHash},
      {kind:"release",route:"release:runtime-readback",artifactPath:"release-runtime-readback.json",sha256:$runtimeHash},
      {kind:"release",route:"release:app-oci-inspect",artifactPath:"release-app-oci-inspect.json",sha256:$appHash},
      {kind:"release",route:"release:gateway-oci-inspect",artifactPath:"release-gateway-oci-inspect.json",sha256:$gatewayHash}
    ]}' > "${staging}/acceptance-release-readbacks.json"
  chmod 0600 "${staging}/acceptance-release-readbacks.json"
  require_root_owned_file "${staging}/acceptance-release-readbacks.json"
  mv "$staging" "$evidence_root"
  staging=""
  trap - EXIT
}

main() {
  [[ "$(id -u)" == "0" ]] || fail "deployment gateway must run as root"
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    deploy_release "${BASH_REMATCH[1]}"
    return
  fi
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^collect-readbacks\ ([0-9a-f]{40})\ ([0-9]{6,20})$ ]]; then
    collect_release_readbacks "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return
  fi
  fail "unsupported gateway command"
}

main "$@"
