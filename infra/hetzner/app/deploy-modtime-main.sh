#!/usr/bin/env bash
# MODTIME-only transport; transactions and recovery belong to manage-release.mjs.
set -euo pipefail
readonly ROOT=/opt/aibrain-modtime/ghcr-ops
readonly CONFIG=/etc/aibrain/modtime
readonly STATE="$CONFIG/release-state.json"
readonly ENV_FILE="$CONFIG/compose.env"
readonly PUBLIC_URL=https://modtime.46.62.215.84.sslip.io
fail() { printf 'MODTIME_DEPLOY_FAILED: %s\n' "$1" >&2; exit 1; }
controlled() {
  [[ -f "$1" && ! -L "$1" && "$(stat -c %u "$1")" == 0 && "$(stat -c %h "$1")" == 1 ]] || fail 'invalid controlled file'
  (( (8#$(stat -c %a "$1") & 8#022) == 0 )) || fail 'writable controlled file'
}
health() {
  curl --fail --silent --show-error --max-time 20 "$PUBLIC_URL/api/health/live" >/dev/null
  curl --fail --silent --show-error --max-time 20 "$PUBLIC_URL/api/health/ready" >/dev/null
}
[[ "$(id -u)" == 0 ]] || fail 'root gateway required'
controlled "$ENV_FILE"
grep -qx 'AIBRAIN_INSTALLATION_ID=modtime' "$ENV_FILE" || fail 'wrong installation'
grep -qx 'AIBRAIN_COMPOSE_PROJECT_NAME=aibrain-modtime' "$ENV_FILE" || fail 'wrong compose project'
if [[ "${SSH_ORIGINAL_COMMAND:-}" == status ]]; then
  health
  revision="$(docker inspect aibrain-modtime-app-1 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid runtime identity'
  ledger=false; [[ ! -f "$STATE" ]] || ledger=true
  jq -n --arg revision "$revision" --argjson ledger "$ledger" '{installationId:"modtime",revision:$revision,releaseLedger:$ledger,readOnly:true}'
  exit 0
fi
[[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy-ghcr\ ([0-9a-f]{40})\ (ghcr\.io/arnautxu/aibrain@sha256:[0-9a-f]{64})\ (ghcr\.io/arnautxu/aibrain-egress@sha256:[0-9a-f]{64})\ ([A-Za-z0-9][A-Za-z0-9-]{0,38})$ ]] || fail 'unsupported gateway command'
revision="${BASH_REMATCH[1]}"; app_image="${BASH_REMATCH[2]}"; egress_image="${BASH_REMATCH[3]}"; ghcr_user="${BASH_REMATCH[4]}"
umask 077
exec 9>"$CONFIG/fleet-deploy.lock"
flock --exclusive --nonblock 9 || fail 'another MODTIME promotion is running'
# A legacy docker-save installation must be migrated with controlling runtime
# readback first. Never fabricate a V3 ledger from an image ID without a digest.
controlled "$STATE"
controlled "$ROOT/manage-release.mjs"
controlled "$ROOT/compose.yaml"
controlled "$ROOT/browser/seccomp_profile.json"
controlled "$CONFIG/installation.json"
jq -e '.schemaVersion == 3 and .installationId == "modtime" and .composeProject == "aibrain-modtime"' "$STATE" >/dev/null || fail 'release bootstrap required'
jq -e '.installationId == "modtime" and .companySlug == "modtime"' "$CONFIG/installation.json" >/dev/null || fail 'foreign branding config'
# The reviewed effective Compose includes the private MODTIME branding mount.
grep -q '/srv/aibrain-modtime/branding' "$ROOT/compose.yaml" || fail 'MODTIME branding mount missing'
grep -q '/app/public/branding/modtime' "$ROOT/compose.yaml" || fail 'MODTIME branding target missing'
if jq -e --arg revision "$revision" --arg app "$app_image" --arg egress "$egress_image" '.current.revision == $revision and .current.image == $app and .current.egressImage == $egress' "$STATE" >/dev/null; then
  health
  for service in app automation-worker ingress-gateway egress-gateway alert-dispatcher; do
    name="aibrain-modtime-${service}-1"
    expected="$app_image"; [[ "$service" != *gateway ]] || expected="$egress_image"
    actual="$(docker inspect "$name" --format '{{.Config.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')"
    [[ "$actual" == "$expected|true|healthy" ]] || fail 'current runtime differs from release ledger'
  done
  printf 'MODTIME_DEPLOY_ALREADY_CURRENT revision=%s\n' "$revision"
  exit 0
fi
work="$(mktemp -d "$CONFIG/fleet-release.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
# Only an ephemeral Actions package-read token arrives on stdin. No token log,
# command argument, shared Docker config or persistent registry credential.
token="$(head -c 16385)"
[[ -n "$token" && "${#token}" -le 16384 ]] || fail 'invalid temporary registry credential'
printf '%s' "$token" | docker --config "$work/docker" login ghcr.io -u "$ghcr_user" --password-stdin >/dev/null
unset token
docker --config "$work/docker" pull "$app_image" >/dev/null
docker --config "$work/docker" pull "$egress_image" >/dev/null
rm -rf -- "$work/docker"
cp "$CONFIG/installation.json" "$work/installation.json"
awk -v app="$app_image" -v egress="$egress_image" -v revision="$revision" '
  /^AIBRAIN_IMAGE=/ {print "AIBRAIN_IMAGE=" app; next}
  /^AIBRAIN_EGRESS_IMAGE=/ {print "AIBRAIN_EGRESS_IMAGE=" egress; next}
  /^AIBRAIN_REVISION=/ {print "AIBRAIN_REVISION=" revision; next}
  {print}
' "$ENV_FILE" > "$work/compose.env"
node "$ROOT/manage-release.mjs" promote --installation-id modtime \
  --image "$app_image" --egress-image "$egress_image" --revision "$revision" \
  --env-file "$ENV_FILE" --target-env-file "$work/compose.env" \
  --compose-file "$ROOT/compose.yaml" --installation-config "$work/installation.json" \
  --state-file "$STATE" --health-timeout-ms 240000 --docker-command-timeout-ms 240000
health
jq --arg revision "$revision" '{installationId,requestedRevision:$revision,current:{revision:.current.revision,image:.current.image,egressImage:.current.egressImage},previous:{revision:.previous.revision}}' "$STATE"
