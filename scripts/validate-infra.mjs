import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const relative = (file) => path.join(root, file);
const failures = [];

function requireMatch(contents, expression, message) {
  if (!expression.test(contents)) failures.push(message);
}

function forbidMatch(contents, expression, message) {
  if (expression.test(contents)) failures.push(message);
}

function read(file) {
  return readFileSync(relative(file), "utf8");
}

const dockerfile = read("Dockerfile");
const compose = read("infra/hetzner/compose.yaml");
const composeBuild = read("infra/hetzner/compose.build.yaml");
const worker = read("infra/hetzner/app/worker-sandbox.sh");
const browserSandbox = read("infra/hetzner/app/browser-sandbox.sh");
const backup = read("infra/hetzner/app/backup.sh");
const backupReplicate = read("infra/hetzner/app/backup-replicate.sh");
const alerts = read("infra/hetzner/app/alerts.sh");
const alertController = read("infra/hetzner/app/alert-controller.sh");
const alertControllerHealthcheck = read("infra/hetzner/app/alert-controller-healthcheck.mjs");
const documentMaintenance = read("infra/hetzner/app/document-maintenance.sh");
const entrypoint = read("infra/hetzner/app/entrypoint.sh");
const soffice = read("infra/hetzner/app/soffice-safe.sh");
const healthcheck = read("infra/hetzner/app/healthcheck.mjs");
const nginx = read("infra/hetzner/nginx/aibrain.conf.example");
const nginxDefaultDeny = read("infra/hetzner/nginx/default-deny.conf");
const runtimeEnv = read("infra/hetzner/aibrain.env.example");
const composeEnv = read("infra/hetzner/compose.env.example");
const egressEnv = read("infra/hetzner/egress.env.example");
const alertsEnv = read("infra/hetzner/alerts.env.example");
const replicaEnv = read("infra/hetzner/replica.env.example");
const egressGateway = read("infra/hetzner/egress/gateway.mts");
const ingressGateway = read("infra/hetzner/ingress/gateway.mts");
const seccompProfile = JSON.parse(read("infra/hetzner/browser/seccomp_profile.json"));
const hostPreflight = read("scripts/validate-host-preflight.mjs");
const releaseManager = read("scripts/manage-release.mjs");
const backupOrchestrator = read("scripts/orchestrate-backup.mjs");
const backupRecoveryUnit = read("infra/hetzner/systemd/aibrain-backup-recovery@.service");
const journaldRetention = read("infra/hetzner/systemd/journald-disk-retention.conf");
const backupControllerEnv = read("infra/hetzner/backup-controller.env.example");
const installation = JSON.parse(read("infra/hetzner/installation.qa.example.json"));
const chromeRuntime = read("src/runtime/browser/chrome-runtime.ts");
const browserEgressProxy = read("src/runtime/browser/egress-proxy.ts");
const workerCodexTurn = read("src/runtime/worker-codex-turn.ts");
const turnAttachments = read("src/documents/turn-attachments.ts");
const productionRunbook = read("docs/PRODUCTION.md");
const arnallDeployGateway = read("infra/hetzner/app/deploy-arnall-main.sh");
const arnallDeployWorkflow = read(".github/workflows/deploy-arnall.yml");
const deployArtifacts = [dockerfile, compose, worker, browserSandbox, backup, backupReplicate, alerts, alertController, alertControllerHealthcheck, documentMaintenance, entrypoint, soffice, runtimeEnv, composeEnv, egressEnv, alertsEnv, replicaEnv, egressGateway, ingressGateway, arnallDeployGateway].join("\n");

forbidMatch([compose, runtimeEnv, composeEnv].join("\n"), /\b(?:Arnay|studio|operations)\b/iu, "Compose/env artifacts contain a tenant/user hardcode");
forbidMatch(dockerfile, /\/(?:codex|workspaces|computer)\/(?:studio|operations)(?:\/|\s|$)/iu, "Dockerfile contains a tenant/user filesystem hardcode");
forbidMatch(deployArtifacts, /docker\.sock/iu, "deployment artifacts reference docker.sock");
forbidMatch(compose, /^\s*privileged\s*:/mu, "Compose enables privileged mode");
forbidMatch(compose, /^\s*network_mode\s*:/mu, "Compose joins another network namespace");
forbidMatch(compose, /^\s*external\s*:\s*true/mu, "Compose reuses an external network or volume");
forbidMatch(arnallDeployGateway, /(?:docker\s+(?:system|builder|image)\s+prune|docker\s+volume\s+(?:rm|prune)|docker\s+network\s+(?:rm|prune)|BGreenly)/iu, "Arnall deploy gateway contains a broad cleanup or foreign tenant reference");
forbidMatch(arnallDeployGateway, /(?:git\s+archive|docker\s+build|docker\s+push|dd\s+if=\/dev\/stdin|tar\s+--extract)/u, "Arnall deploy gateway still receives source or builds locally");
requireMatch(arnallDeployGateway, /SSH_ORIGINAL_COMMAND[\s\S]{0,240}\^deploy-ghcr\\ \(\[0-9a-f\]\{40\}\)/u, "Arnall deploy gateway does not constrain the forced SSH command to revision and GHCR digests");
requireMatch(arnallDeployGateway, /AIBRAIN_INSTALLATION_ID=\$\{INSTALLATION_ID\}[\s\S]{0,250}AIBRAIN_COMPOSE_PROJECT_NAME=\$\{COMPOSE_PROJECT\}/u, "Arnall deploy gateway does not verify the exact installation and Compose project");
requireMatch(arnallDeployGateway, /GHCR_APP_REPOSITORY="ghcr\.io\/arnautxu\/aibrain"[\s\S]{0,160}GHCR_EGRESS_REPOSITORY="ghcr\.io\/arnautxu\/aibrain-egress"/u, "Arnall deploy gateway does not pin the two approved GHCR repositories");
requireMatch(arnallDeployGateway, /mktemp -d "\$\{RELEASE_ROOT\}\/.ghcr-docker\.[X]+"[\s\S]{0,500}docker --config "\$ghcr_docker_config" pull "\$app_image"[\s\S]{0,160}pull "\$egress_image"/u, "Arnall deploy gateway does not use ephemeral GHCR authentication for exact pulls");
requireMatch(arnallDeployGateway, /verify_public_health[\s\S]{0,180}cleanup_inactive_aibrain_images[\s\S]{0,120}cleanup_legacy_release_directories/u, "Arnall deploy gateway does not run bounded storage retention after public health");
requireMatch(journaldRetention, /^\[Journal\]\nSystemMaxUse=512M\n$/u, "journald retention does not enforce the reviewed persistent disk cap");
requireMatch(arnallDeployGateway, /manage-release\.mjs[\s\S]*health\/live[\s\S]*health\/ready/u, "Arnall deploy gateway does not promote transactionally and verify public health");
requireMatch(arnallDeployGateway, /require_noninteractive_browser_policy[\s\S]*CODEX_APPROVAL_POLICY=never[\s\S]*AIBRAIN_BROWSER_INTERACTIVE_APPROVALS=disabled/u, "Arnall deploy gateway does not fail closed on interactive browser approval policy");
requireMatch(arnallDeployWorkflow, /workflow_run:[\s\S]*Publish GHCR images[\s\S]*conclusion == 'success'/u, "Arnall deployment is not gated on successful GHCR publication after Backend CI");
requireMatch(arnallDeployWorkflow, /deploy-ghcr \$TESTED_SHA \$APP_IMAGE \$EGRESS_IMAGE \$GHCR_USERNAME/u, "Arnall deployment does not transmit the immutable tested GHCR digests");
requireMatch(arnallDeployWorkflow, /actions\/workflows\/backend-ci\.yml\/runs[\s\S]*\.name == "Backend CI"[\s\S]*backend_ci_run_id/u, "Arnall deployment does not resolve the real successful Backend CI run for the release SHA");
requireMatch(arnallDeployWorkflow, /collect-readbacks \$TESTED_SHA \$BACKEND_CI_RUN_ID \$PUBLISH_RUN_ID \$DEPLOY_RUN_ID \$APP_DIGEST \$EGRESS_DIGEST/u, "Arnall readback does not preserve separate Backend CI, Publish and Deploy identities plus both digests");
forbidMatch(arnallDeployWorkflow, /CI_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/u, "Arnall deployment still labels the Publish run as Backend CI");
requireMatch(arnallDeployWorkflow, /GHCR_PULL_TOKEN: \$\{\{ github\.token \}\}/u, "Arnall deployment does not use its temporary package token for the pull");
requireMatch(arnallDeployWorkflow, /StrictHostKeyChecking=yes[\s\S]*UserKnownHostsFile=/u, "Arnall deployment does not pin the SSH host identity");

requireMatch(dockerfile, /@openai\/codex@0\.149\.1/u, "Dockerfile does not pin the approved Codex version");
forbidMatch(dockerfile, /ARG CODEX_VERSION/u, "Dockerfile permits the App Server contract version to be overridden");
requireMatch(dockerfile, /ARG NODE_IMAGE=node:24\.18\.1-bookworm-slim@sha256:[0-9a-f]{64}/u, "Dockerfile does not pin the reviewed Node 24 runtime digest");
requireMatch(dockerfile, /ARG DEBIAN_SNAPSHOT=\d{8}T\d{6}Z/u, "Dockerfile does not pin an immutable Debian snapshot");
requireMatch(dockerfile, /snapshot\.debian\.org\/archive\/debian\/\$\{DEBIAN_SNAPSHOT\}/u, "Dockerfile APT source is not the pinned Debian snapshot");
requireMatch(dockerfile, /snapshot\.debian\.org\/archive\/debian-security\/\$\{DEBIAN_SNAPSHOT\}/u, "Dockerfile security APT source is not the pinned Debian snapshot");
requireMatch(dockerfile, /USER aibrain:aibrain/u, "Dockerfile final process is not non-root");
requireMatch(dockerfile, /\bbubblewrap\b/u, "Dockerfile does not install the worker mount sandbox");
requireMatch(dockerfile, /src\/documents\/publication-locks\.ts/u, "Dockerfile backup CLI is missing the shared publication barrier contract");
requireMatch(dockerfile, /src\/operations\/backup-replica\.ts/u, "Dockerfile is missing the encrypted backup replica adapter");
requireMatch(dockerfile, /scripts\/replicate-backup\.ts/u, "Dockerfile is missing the backup replica CLI");
requireMatch(dockerfile, /scripts\/run-operational-alerts\.ts/u, "Dockerfile is missing the operational alert collector CLI");
requireMatch(dockerfile, /src\/operations\/alert-delivery\.ts/u, "Dockerfile is missing durable alert delivery");
requireMatch(dockerfile, /infra\/hetzner\/app\/alerts\.sh/u, "Dockerfile is missing the operational alert launcher");
requireMatch(dockerfile, /infra\/hetzner\/app\/alert-controller\.sh/u, "Dockerfile is missing the external alert controller");
requireMatch(dockerfile, /scripts\/maintain-document-temporaries\.ts/u, "Dockerfile is missing the document maintenance CLI");
requireMatch(dockerfile, /src\/documents\/maintenance\.ts/u, "Dockerfile is missing document maintenance logic");
requireMatch(dockerfile, /infra\/hetzner\/app\/document-maintenance\.sh/u, "Dockerfile is missing the document maintenance launcher");
requireMatch(documentMaintenance, /maintain-document-temporaries\.ts "\$@"/u, "document maintenance launcher does not preserve explicit arguments");
for (const tool of ["libreoffice-writer", "libreoffice-calc", "libreoffice-impress", "poppler-utils", "python3", "python3-venv", "qpdf", "chromium", "restic"]) {
  requireMatch(dockerfile, new RegExp(`\\b${tool}\\b`, "u"), `Dockerfile is missing ${tool}`);
}
requireMatch(dockerfile, /CODEX_BIN=\/usr\/local\/bin\/aibrain-codex-worker/u, "Codex does not default to the sandbox launcher");
requireMatch(dockerfile, /CODEX_APPROVAL_POLICY=never/u, "Docker image does not disable interactive Codex approvals");
requireMatch(dockerfile, /AIBRAIN_BROWSER_INTERACTIVE_APPROVALS=disabled/u, "Docker image does not disable interactive browser approvals");
forbidMatch(dockerfile, /CODEX_APPROVAL_POLICY=on-request/u, "Docker image re-enables interactive Codex approvals");
requireMatch(compose, /app:[\s\S]*CODEX_APPROVAL_POLICY: never[\s\S]*AIBRAIN_BROWSER_INTERACTIVE_APPROVALS: disabled/u, "App does not disable interactive browser and Codex approvals");
requireMatch(compose, /automation-worker:[\s\S]*CODEX_APPROVAL_POLICY: never[\s\S]*AIBRAIN_BROWSER_INTERACTIVE_APPROVALS: disabled/u, "Automation worker does not disable interactive browser and Codex approvals");
forbidMatch(compose, /CODEX_APPROVAL_POLICY: on-request/u, "Compose re-enables interactive Codex approvals");
requireMatch(dockerfile, /AIBRAIN_CHROME_BIN=\/usr\/local\/bin\/aibrain-chrome/u, "Chrome does not default to the employee sandbox launcher");
requireMatch(browserSandbox, /set -- \/usr\/bin\/chromium --no-sandbox "\$@"[\s\S]*exec \/usr\/bin\/bwrap/u, "Browser launcher does not disable only Chromium's nested sandbox before the mandatory bwrap boundary");
requireMatch(browserSandbox, /export TMPDIR=\/tmp[\s\S]*set -- \/usr\/bin\/chromium/u, "Browser launcher does not keep Chromium's process-singleton socket inside the short private bwrap tmpfs path");
requireMatch(chromeRuntime, /args\.includes\("--no-sandbox"\)[\s\S]*CHROME_ARGUMENTS_UNSAFE/u, "Chrome runtime accepts application-supplied sandbox bypass arguments");
for (const tool of ["soffice", "pdfinfo", "pdftoppm", "pdftotext", "qpdf"]) {
  requireMatch(dockerfile, new RegExp(`COPY --chown=root:root infra/hetzner/app/soffice-safe\\.sh /usr/local/bin/aibrain-${tool}`, "u"), `Dockerfile does not install the sandboxed ${tool} launcher`);
}
requireMatch(dockerfile, /org\.opencontainers\.image\.revision="\$\{AIBRAIN_REVISION\}"/u, "Docker image does not record its exact source revision");
requireMatch(dockerfile, /FROM \$\{NODE_IMAGE\} AS egress-gateway/u, "Dockerfile lacks the first-party egress gateway target on the pinned Node base");
requireMatch(dockerfile, /FROM \$\{NODE_IMAGE\} AS egress-gateway[\s\S]*FROM \$\{NODE_IMAGE\} AS dependencies/u, "egress target follows the expensive application builder under the legacy server builder");
requireMatch(dockerfile, /USER aibrain-egress:aibrain-egress[\s\S]*ENTRYPOINT \["node", "\/usr\/local\/share\/aibrain\/egress-gateway\.mts"\]/u, "egress gateway image is not an unprivileged first-party Node target");

for (const marker of [
  "read_only: true",
  "cap_drop:",
  "no-new-privileges:true",
  "healthcheck:",
  "pids_limit:",
  "mem_limit:",
  "cpus:",
  "max-size:",
  "create_host_path: false",
]) requireMatch(compose, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `Compose is missing ${marker}`);
requireMatch(compose, /target: \/srv\/aibrain\/source-ro[\s\S]{0,120}read_only: true/u, "source-ro is not a read-only bind mount");
requireMatch(compose, /target: \/srv\/aibrain\/publish-rw/u, "server publisher mount is missing");
requireMatch(compose, /name: "\$\{AIBRAIN_NETWORK_NAME:\?/u, "network name is not required per installation");
requireMatch(compose, /aibrain-internal:[\s\S]{0,180}internal: true/u, "application network is not Docker-internal");
requireMatch(compose, /app:[\s\S]*?networks:\s*\n\s*- aibrain-internal[\s\S]*?healthcheck:/u, "app is not restricted to the internal network");
requireMatch(compose, /egress-gateway:[\s\S]*?networks:\s*\n\s*- aibrain-internal\s*\n\s*- aibrain-egress/u, "egress gateway is missing its explicit dual-homed boundary");
requireMatch(compose, /alert-dispatcher:[\s\S]*?entrypoint: \[\/usr\/bin\/tini, --, \/usr\/local\/bin\/aibrain-alert-controller\][\s\S]*?networks:\s*\n\s*- aibrain-internal\s*\n\s*- aibrain-egress/u, "Compose lacks the dedicated external alert dispatcher");
forbidMatch(compose.match(/  alert-dispatcher:[\s\S]*?(?=\n  egress-gateway:)/u)?.[0] ?? "", /depends_on:[\s\S]*?condition: service_healthy/u, "alert dispatcher cannot wait for app health before reporting app failure");
requireMatch(compose, /alert-dispatcher:[\s\S]*?target: \/var\/lib\/aibrain\/data\/backups\n\s*read_only: true[\s\S]*?target: \/srv\/aibrain\/publish-rw\n\s*read_only: true[\s\S]*?target: \/var\/lib\/aibrain-replication\n\s*read_only: true/u, "alert dispatcher does not keep evidence mounts read-only");
forbidMatch(compose.match(/  alert-dispatcher:[\s\S]*?(?=\n  egress-gateway:)/u)?.[0] ?? "", /^\s*ports\s*:/mu, "alert dispatcher publishes a host port");
requireMatch(alertController, /AIBRAIN_ALERT_SINK[\s\S]{0,100}= webhook[\s\S]*aibrain-alerts[\s\S]*aibrain-alert-controller-status\.json/u, "alert controller does not require webhook delivery and durable status publication");
requireMatch(alertsEnv, /^AIBRAIN_ALERT_WEBHOOK_URL=https:\/\//mu, "alert env example lacks an HTTPS external sink");
requireMatch(alertsEnv, /^AIBRAIN_ALERT_EGRESS_READINESS_URL=http:\/\/egress-gateway:8080\/__aibrain_egress_health$/mu, "alert controller does not probe the private egress gateway");
requireMatch(compose, /backup-replicator:[\s\S]*?profiles: \[backup\][\s\S]*?entrypoint: \[\/usr\/bin\/tini, --, \/usr\/local\/bin\/aibrain-backup-replicate\]/u, "Compose lacks the explicit one-shot backup replicator profile");
requireMatch(compose, /backup-replicator:[\s\S]*?target: \/var\/lib\/aibrain\/data\/backups\n\s*read_only: true/u, "backup replicator can write the verified snapshot volume");
requireMatch(compose, /backup-replicator:[\s\S]*?source: aibrain-restores\n\s*target: \/var\/lib\/aibrain-restores/u, "backup replicator lacks the isolated restore drill volume");
requireMatch(compose, /backup-replicator:[\s\S]*?target: \/var\/lib\/aibrain-replication[\s\S]*?target: \/run\/secrets\/aibrain-restic-password\n\s*read_only: true/u, "backup replicator lacks separate receipt state or a read-only password file");
requireMatch(compose, /backup-replicator:[\s\S]*?networks:\s*\n\s*- aibrain-egress/u, "backup replicator is not isolated to the egress-only network");
forbidMatch(compose.match(/  backup-replicator:[\s\S]*?(?=\n  egress-gateway:)/u)?.[0] ?? "", /^\s*ports\s*:/mu, "backup replicator publishes a host port");
requireMatch(compose, /aibrain-egress:[\s\S]{0,180}name: "\$\{AIBRAIN_EGRESS_NETWORK_NAME:\?/u, "egress network name is not required per installation");
requireMatch(compose, /AIBRAIN_EGRESS_PROXY_URL: http:\/\/egress-gateway:8080/u, "app lacks the private gateway endpoint");
requireMatch(compose, /app:[\s\S]*?AIBRAIN_RUNTIME_INSTANCE: app/u, "app lacks an isolated durable runtime transport role");
requireMatch(compose, /automation-worker:[\s\S]*?AIBRAIN_RUNTIME_INSTANCE: automation-worker/u, "automation worker lacks an isolated durable runtime transport role");
requireMatch(compose, /egress-gateway:[\s\S]*?expose:\s*\n\s*- "8080"/u, "egress gateway is not exposed only inside Compose");
forbidMatch(compose.match(/  egress-gateway:[\s\S]*?(?=\n  ingress-gateway:|\nnetworks:)/u)?.[0] ?? "", /^\s*ports\s*:/mu, "egress gateway publishes a host port");
requireMatch(compose, /ingress-gateway:[\s\S]*?127\.0\.0\.1:\$\{AIBRAIN_HTTP_PORT:[\s\S]*?aibrain-internal[\s\S]*?aibrain-ingress/u, "ingress gateway does not bridge loopback to the private app network");
forbidMatch(compose.match(/  app:[\s\S]*?(?=\n  ingress-gateway:)/u)?.[0] ?? "", /^\s*ports\s*:/mu, "app publishes a host port instead of using the ingress gateway");
requireMatch(ingressGateway, /targetHost !== "app"[\s\S]*targetPort !== 3000/u, "ingress gateway target is not immutable");
forbidMatch(ingressGateway, /child_process|fetch\(|http\.request/u, "ingress gateway exposes functionality beyond fixed TCP forwarding");
requireMatch(compose, /name: "\$\{AIBRAIN_DATA_VOLUME_NAME:\?/u, "data volume name is not required per installation");
requireMatch(compose, /name: "\$\{AIBRAIN_BACKUP_VOLUME_NAME:\?/u, "backup volume name is not required per installation");
requireMatch(compose, /name: "\$\{AIBRAIN_RESTORE_VOLUME_NAME:\?/u, "restore volume name is not required per installation");
requireMatch(compose, /com\.graphikai\.aibrain\.installation:[^\n]*AIBRAIN_INSTALLATION_ID/u, "Compose resources are not labelled by installation");
requireMatch(compose, /- "127\.0\.0\.1:\$\{AIBRAIN_HTTP_PORT:\?/u, "HTTP binding is not fixed to loopback");
forbidMatch(compose, /AIBRAIN_BIND_ADDRESS/u, "Compose permits the loopback binding to be overridden");
requireMatch(compose, /test: \[CMD, node, \/usr\/local\/share\/aibrain\/healthcheck\.mjs\]/u, "Compose does not use the storage-aware healthcheck");
requireMatch(dockerfile, /npm run build:automation-worker[\s\S]*COPY --from=builder --chown=root:root \/app\/dist\/automation-worker\.mjs/u, "Docker image does not contain the compiled immutable automation worker");
forbidMatch(dockerfile, /COPY --from=builder --chown=root:root \/app\/scripts\/run-automations\.ts/u, "Docker image copies TypeScript automation worker source into runtime");
requireMatch(dockerfile, /automation-worker-healthcheck\.mjs/u, "Docker image does not contain the automation worker healthcheck");
requireMatch(compose, /automation-worker:[\s\S]*?entrypoint: \[\/usr\/bin\/tini, --, \/usr\/local\/bin\/aibrain-entrypoint\][\s\S]*?automation-worker\.mjs[\s\S]*?restart: unless-stopped/u, "Compose lacks the supervised compiled automation worker");
forbidMatch(compose.match(/  automation-worker:[\s\S]*?(?=\n  ingress-gateway:)/u)?.[0] ?? "", /\btsx\b|run-automations\.ts/u, "Automation worker invokes a mutable TypeScript runtime");
requireMatch(compose, /automation-worker:[\s\S]*?target: \/var\/lib\/aibrain\/data[\s\S]*?healthcheck:[\s\S]*?automation-worker-healthcheck\.mjs/u, "Automation worker lacks the shared durable volume or a fresh-heartbeat healthcheck");
forbidMatch(compose, /^\s*build\s*:/mu, "runtime Compose permits an implicit mutable image build");
requireMatch(composeBuild, /AIBRAIN_REVISION: "\$\{AIBRAIN_REVISION:\?/u, "build override does not require an exact source revision");
requireMatch(composeBuild, /context: \.\.\/\.\./u, "build override does not use the reviewed repository context");
requireMatch(composeBuild, /egress-gateway:[\s\S]*target: egress-gateway/u, "build override does not build the reviewed egress target");
for (const [key, tool] of [
  ["AIBRAIN_SOFFICE_BIN", "soffice"],
  ["AIBRAIN_PDFINFO_BIN", "pdfinfo"],
  ["AIBRAIN_PDFTOPPM_BIN", "pdftoppm"],
  ["AIBRAIN_PDFTOTEXT_BIN", "pdftotext"],
  ["AIBRAIN_QPDF_BIN", "qpdf"],
]) {
  requireMatch(compose, new RegExp(`${key}: /usr/local/bin/aibrain-${tool}`, "u"), `Compose bypasses the sandboxed ${tool} launcher`);
}

requireMatch(egressGateway, /headers\["proxy-authorization"\][\s\S]{0,500}value\.startsWith\("Bearer "\)[\s\S]{0,500}value\.startsWith\("Basic "\)/u, "egress gateway lacks authenticated Bearer and Basic channels");
requireMatch(egressGateway, /timingSafeEqual/u, "egress gateway does not compare channel tokens safely");
requireMatch(egressGateway, /scheme === "basic" && channel === "browser"/u, "egress gateway does not reserve Basic auth for standard worker/server clients");
requireMatch(egressGateway, /x-aibrain-pinned-ip/u, "browser channel does not require the upstream DNS pin");
requireMatch(egressGateway, /port !== 80 && port !== 443/u, "browser channel is not limited to ports 80 and 443");
requireMatch(egressGateway, /port !== 443/u, "worker/server channels are not limited to HTTPS");
requireMatch(egressGateway, /!this\.config\.workerHosts\.has\(hostname\)/u, "worker channel does not enforce an exact hostname allowlist");
requireMatch(egressGateway, /hostname !== this\.config\.supabaseHostname/u, "server channel is not restricted to configured Supabase");
requireMatch(egressGateway, /DNS returned a non-global or mixed destination/u, "gateway does not fail closed on private or mixed DNS answers");
requireMatch(egressGateway, /const selected = results\[0\]![\s\S]{0,160}address: selected\.address/u, "worker/server connection is not pinned to one approved DNS result");
forbidMatch(egressGateway, /console\.(?:log|error)|process\.env\[["']AIBRAIN_EGRESS_.*TOKEN/u, "gateway risks logging or dynamically exposing channel tokens");

requireMatch(worker, /--ro-bind \/ \/[\s\S]*--tmpfs "\$publish_root"[\s\S]*--remount-ro "\$publish_root"/u, "worker does not mask publish-rw behind a read-only mount");
requireMatch(worker, /--tmpfs "\$data_root"[\s\S]*--ro-bind "\$company_root" "\$company_root"[\s\S]*--ro-bind "\$source_root" "\$source_root"/u, "worker does not hide product data before re-exposing approved read roots");
requireMatch(worker, /company context root is outside dataRoot[\s\S]*users root is outside dataRoot[\s\S]*employee root is outside usersRoot/u, "worker does not fail closed on configured root containment");
for (const contextFile of ["PROFILE.md", "PREFERENCES.md", "PERMISSIONS.md"]) {
  requireMatch(worker, new RegExp(`--ro-bind "\\$user_root/${contextFile}" "\\$user_root/${contextFile}"`, "u"), `worker sandbox is missing private ${contextFile}`);
}
for (const writable of ["runtime_root", "workspace", "artifacts_root", "transport_audit_root"]) {
  requireMatch(worker, new RegExp(`--bind "\\$${writable}" "\\$${writable}"`, "u"), `worker sandbox is missing its declared ${writable} write root`);
}
requireMatch(worker, /--bind "\$staging_root\/tmp" "\$staging_root\/tmp"/u, "worker sandbox is missing its private temporary directory");
forbidMatch(worker, /--bind "\$staging_root" "\$staging_root"/u, "worker sandbox exposes all staged uploads");
requireMatch(worker, /--ro-bind "\$uploaded_documents_root" "\$uploaded_documents_root"/u, "worker sandbox does not expose the employee upload directory read-only");
forbidMatch(worker, /--bind "\$uploaded_documents_root" "\$uploaded_documents_root"/u, "worker sandbox exposes uploaded documents as writable");
forbidMatch(worker, /--bind "\$publish_root"/u, "worker sandbox exposes publish-rw as a real writable bind");
forbidMatch(workerCodexTurn, /runtimeWorkspaceRoots:\s*\[[^\]]*roots\.staging/gu, "Codex turn exposes the employee staging root as a workspace");
forbidMatch(workerCodexTurn, /runtimeWorkspaceRoots[\s\S]{0,700}(?:sourceReadRoot|companyContextRoot|uploadedDocuments)/u, "Codex turn promotes a read-only mount to an inner App Server workspace");
requireMatch(workerCodexTurn, /aibrain_documents\.create[\s\S]{0,600}No uses Google Drive/u, "Codex turn does not default document generation to the private local workspace");
requireMatch(turnAttachments, /No filesystem staging path is exposed/u, "turn document inputs do not declare the server-only staging boundary");
forbidMatch(turnAttachments, /result\.push\(\{\s*type:\s*"(?:mention|localImage|localAudio)"/u, "turn document inputs expose server-local staging paths");
requireMatch(browserSandbox, /--tmpfs "\$data_root"[\s\S]*--bind "\$browser_root" "\$browser_root"/u, "browser sandbox does not hide product data before exposing one employee browser root");
requireMatch(browserSandbox, /--tmpfs "\$source_root"[\s\S]*--remount-ro "\$source_root"[\s\S]*--tmpfs "\$publish_root"[\s\S]*--remount-ro "\$publish_root"/u, "browser sandbox does not mask source and publish roots");
requireMatch(browserSandbox, /--unshare-pid[\s\S]*--proc \/proc/u, "browser sandbox does not isolate the process namespace");
forbidMatch(browserSandbox, /--unshare-net/u, "browser sandbox cannot reach its mandatory pinned loopback egress proxy");
requireMatch(entrypoint, /bubblewrap worker isolation is unavailable/u, "entrypoint does not fail closed when worker isolation is unavailable");
requireMatch(entrypoint, /\/usr\/local\/bin\/aibrain-alerts/u, "entrypoint does not require the alert launcher");
requireMatch(entrypoint, /\/usr\/bin\/restic/u, "entrypoint does not require the encrypted replica runtime");
requireMatch(entrypoint, /AIBRAIN_CHROME_BIN must use the employee browser filesystem sandbox/u, "entrypoint does not require the browser sandbox launcher");
requireMatch(entrypoint, /bubblewrap browser isolation is unavailable/u, "entrypoint does not fail closed when browser isolation is unavailable");
requireMatch(entrypoint, /bubblewrap document isolation is unavailable/u, "entrypoint does not fail closed when document isolation is unavailable");
for (const tool of ["soffice", "pdfinfo", "pdftoppm", "pdftotext", "qpdf"]) {
  requireMatch(entrypoint, new RegExp(`/usr/local/bin/aibrain-${tool}`, "u"), `entrypoint does not require the sandboxed ${tool} launcher`);
}
requireMatch(entrypoint, /--tmpfs \/var\/lib\/aibrain\/data[\s\S]*--ro-bind \/var\/lib\/aibrain\/data\/company-context \/var\/lib\/aibrain\/data\/company-context/u, "entrypoint does not exercise the worker data visibility boundary");
requireMatch(entrypoint, /source-ro is missing or writable/u, "entrypoint does not verify the source-ro mount");
requireMatch(entrypoint, /codex-real --version[\s\S]*actual_codex_version[\s\S]*generated App Server contracts/u, "entrypoint does not enforce the contract-pinned Codex version");
requireMatch(healthcheck, /docker\.sock[\s\S]*127\.0\.0\.1:3000\/api\/health\/ready/u, "healthcheck does not verify socket absence and loopback readiness");
requireMatch(nginx, /server 127\.0\.0\.1:__AIBRAIN_HTTP_PORT__/u, "Nginx upstream is not constrained to the installation loopback port");
requireMatch(nginx, /location = \/api\/chat[\s\S]*proxy_buffering off;[\s\S]*X-Accel-Buffering no/u, "Nginx buffers the streaming chat response");
requireMatch(nginx, /\/documents\$[\s\S]*client_max_body_size 52m;[\s\S]*proxy_request_buffering off;/u, "Nginx does not stream bounded document uploads");
requireMatch(nginx, /zone=aibrain___AIBRAIN_INSTANCE_TOKEN___auth/u, "Nginx does not isolate the auth limit zone per installation");
requireMatch(nginx, /upstream aibrain___AIBRAIN_INSTANCE_TOKEN___backend/u, "Nginx does not isolate the upstream per installation");
requireMatch(nginx, /location ~ \^\/api\/auth\/[\s\S]*limit_req zone=aibrain___AIBRAIN_INSTANCE_TOKEN___auth/u, "Nginx does not rate-limit auth mutations");
requireMatch(nginx, /location = \/api\/operations\/maintenance[\s\S]{0,80}return 404/u, "Nginx exposes the operator maintenance endpoint publicly");
requireMatch(nginx, /location = \/api\/operations\/users[\s\S]{0,160}return 404/u, "Nginx exposes the operator user-lifecycle endpoint publicly");
requireMatch(nginx, /return 301 https:\/\/__AIBRAIN_PUBLIC_HOST__\$request_uri/u, "Nginx redirect trusts the client Host header");
requireMatch(nginxDefaultDeny, /listen 80 default_server[\s\S]*return 444/u, "Nginx lacks an HTTP default-deny virtual host");
requireMatch(nginxDefaultDeny, /listen 443 ssl default_server[\s\S]*ssl_reject_handshake on/u, "Nginx lacks a TLS default-deny virtual host");
forbidMatch(nginx, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/u, "Nginx trusts a client-supplied forwarding chain");
requireMatch(hostPreflight, /\.aibrain-owner\.json/u, "host preflight does not require ownership markers");
requireMatch(hostPreflight, /AIBRAIN_BACKUP_VOLUME_NAME[\s\S]*AIBRAIN_RESTORE_VOLUME_NAME/u, "host preflight does not validate independent backup and restore volumes");
requireMatch(hostPreflight, /existing Docker[\s\S]*not owned/u, "host preflight does not reject foreign Docker resources");
requireMatch(hostPreflight, /must never address BGreenly/u, "host preflight does not fail closed on BGreenly paths");
requireMatch(hostPreflight, /\/usr\/bin\/flock/u, "host preflight does not require OS release serialization on Linux");
requireMatch(releaseManager, /@sha256:\[0-9a-f\]\{64\}/u, "release manager does not require immutable image digests");
requireMatch(releaseManager, /org\.opencontainers\.image\.revision/u, "release manager does not verify the OCI source revision");
requireMatch(releaseManager, /RELEASE_RECOVERED/u, "release manager does not recover the previous healthy image after failure");
requireMatch(releaseManager, /writeAtomic\(options\.stateFile/u, "release manager does not persist current and previous releases atomically");
requireMatch(releaseManager, /target-healthy[\s\S]*state-committed/u, "release manager lacks a durable promotion transaction");
requireMatch(releaseManager, /RELEASE_DOCKER_TIMEOUT/u, "release manager does not bound Docker subprocesses");
requireMatch(releaseManager, /\{\{\.Config\.Image\}\}/u, "release manager does not verify running container image identity");
requireMatch(releaseManager, /"alert-dispatcher"/u, "release manager does not promote and verify the alert dispatcher");
requireMatch(releaseManager, /"up", "-d", "--force-recreate", "--no-deps",[\s\S]*?"automation-worker"/u, "release manager does not promote the automation worker");
requireMatch(releaseManager, /installationConfigSha256[\s\S]*composeSha256[\s\S]*environmentSha256/u, "release manager does not version config, Compose and environment hashes");
requireMatch(releaseManager, /active\.compose\.yaml/u, "release manager does not materialize the exact versioned Compose input");
requireMatch(releaseManager, /--force-recreate/u, "release manager does not recreate services for config-only releases");
requireMatch(releaseManager, /\/usr\/bin\/flock/u, "release manager lacks OS advisory locking on Linux");
requireMatch(releaseManager, /\/usr\/bin\/lockf/u, "release manager lacks OS advisory locking on macOS QA");
requireMatch(backupOrchestrator, /snapshot-created[\s\S]*snapshot-verified[\s\S]*app-restarted[\s\S]*admission-resumed/u, "backup orchestrator lacks durable recovery phases");
requireMatch(backupOrchestrator, /AIBRAIN_MAINTENANCE_SECRET/u, "backup orchestrator does not read the private maintenance secret");
requireMatch(backupOrchestrator, /"stop", "app"[\s\S]*createSnapshot[\s\S]*verifySnapshot/u, "backup orchestrator does not stop app and verify the snapshot");
requireMatch(backupOrchestrator, /\/usr\/bin\/flock/u, "backup orchestrator lacks Linux OS advisory locking");
requireMatch(backupOrchestrator, /\/usr\/bin\/lockf/u, "backup orchestrator lacks macOS OS advisory locking");
requireMatch(backupRecoveryUnit, /After=docker\.service[\s\S]*orchestrate-backup\.mjs recover[\s\S]*NoNewPrivileges=true/u, "systemd does not recover interrupted backups after Docker startup");
requireMatch(alertController, /aibrain-alert-controller-status\.pending[\s\S]*mv[\s\S]*aibrain-alert-controller-status\.json/u, "alert controller does not publish status atomically");
requireMatch(alertControllerHealthcheck, /AIBRAIN_ALERT_PENDING_WARN_AGE_MS[\s\S]*delivery: "degraded"/u, "alert dispatcher health does not expose degraded delivery separately from controller liveness");
requireMatch(egressGateway, /healthToken[\s\S]*timingSafeEqual[\s\S]*AIBRAIN_EGRESS_HEALTH_TOKEN/u, "egress health is not authenticated with its dedicated secret");
requireMatch(alertsEnv, /AIBRAIN_ALERT_MAX_ATTEMPTS/u, "alert environment lacks bounded delivery");
requireMatch(alertsEnv, /AIBRAIN_ALERT_EGRESS_HEALTH_TOKEN/u, "alert environment lacks health authentication");
requireMatch(backupControllerEnv, /^AIBRAIN_BACKUP_COMPOSE_FILE=.*active\.compose\.yaml$/mu, "backup controller is not pinned to the active versioned Compose input");
requireMatch(chromeRuntime, /"--remote-debugging-pipe"/u, "Chrome runtime does not use the inherited private CDP pipe");
requireMatch(chromeRuntime, /stdio: \["ignore", "ignore", "pipe", "pipe", "pipe"\]/u, "Chrome runtime does not reserve inherited CDP fds 3 and 4");
forbidMatch(chromeRuntime, /--remote-debugging-(?:port|address)/u, "Chrome runtime reintroduces a network CDP endpoint");
forbidMatch(chromeRuntime, /DevToolsActivePort/u, "Chrome runtime depends on the filesystem-discoverable DevTools endpoint");
requireMatch(chromeRuntime, /new BrowserEgressProxy\(\{ networkPolicy: this\.networkPolicy \}\)/u, "Chrome runtime does not share its network policy with the pinned egress proxy");
requireMatch(chromeRuntime, /await this\.egressProxy\.start\(\)[\s\S]{0,300}launchPipeWithBackoff/u, "Chrome runtime does not start pinned egress before Chrome");
requireMatch(chromeRuntime, /"--proxy-bypass-list=<-loopback>"/u, "Chrome runtime permits Chrome's implicit loopback proxy bypass");
requireMatch(chromeRuntime, /`--proxy-server=\$\{proxyUrl\}`/u, "Chrome runtime does not force browser traffic through its private proxy");
requireMatch(chromeRuntime, /"--disable-quic"/u, "Chrome runtime does not disable direct QUIC egress");
requireMatch(chromeRuntime, /"--force-webrtc-ip-handling-policy=disable_non_proxied_udp"/u, "Chrome runtime permits direct non-proxied WebRTC UDP egress");
requireMatch(chromeRuntime, /finally \{[\s\S]{0,120}this\.egressProxy\?\.stop\(\)/u, "Chrome runtime does not stop pinned egress in its teardown guarantee");
requireMatch(chromeRuntime, /await this\.egressProxy\.health\(\)/u, "Chrome health does not include pinned egress health");
requireMatch(browserEgressProxy, /server\.listen\(\{ host: "127\.0\.0\.1", port: 0, exclusive: true \}\)/u, "Browser egress proxy is not an exclusive ephemeral loopback listener");
requireMatch(browserEgressProxy, /this\.networkPolicy\.assertAllowed\(/u, "Browser egress proxy bypasses BrowserNetworkPolicy");
requireMatch(browserEgressProxy, /DEFAULT_ALLOWED_PORTS = Object\.freeze\(\[80, 443\]\)/u, "Browser egress proxy does not restrict public service ports");
requireMatch(productionRunbook, /canal CDP heredado[\s\S]*sin socket TCP/u, "production runbook does not document the private CDP process boundary");
for (const syscall of ["ptrace", "process_vm_readv", "process_vm_writev"]) {
  const unsafeRule = seccompProfile.syscalls?.find((rule) =>
    rule.action === "SCMP_ACT_ALLOW" && rule.names?.includes(syscall) &&
    !rule.includes?.caps?.includes("CAP_SYS_PTRACE"));
  if (unsafeRule) failures.push(`seccomp permits ${syscall} without CAP_SYS_PTRACE`);
}
requireMatch(soffice, /MacroSecurityLevel[\s\S]*<value>3<\/value>/u, "LibreOffice wrapper does not enforce Very High macro security");
for (const flag of ["--headless", "--safe-mode", "--norestore"]) {
  requireMatch(soffice, new RegExp(flag, "u"), `LibreOffice wrapper does not require ${flag}`);
}
for (const launcher of ["soffice", "pdfinfo", "pdftoppm", "pdftotext", "qpdf"]) {
  requireMatch(soffice, new RegExp(`aibrain-${launcher}\\) tool=/usr/bin/${launcher}`, "u"), `document sandbox cannot dispatch ${launcher}`);
}
for (const boundary of [
  "--unshare-pid",
  "--unshare-ipc",
  "--unshare-uts",
  "--unshare-net",
  "--clearenv",
  "--cap-drop ALL",
  "--tmpfs /etc/aibrain",
  "--tmpfs /var/lib/aibrain/data",
  "--tmpfs /srv/aibrain/source-ro",
  "--tmpfs /srv/aibrain/publish-rw",
  "--bind \"$work_root\" /work",
]) requireMatch(soffice, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `document sandbox is missing ${boundary}`);
requireMatch(soffice, /preview_pattern=.*document-previews[\s\S]*turn_pattern=.*aibrain-turn-document/u, "document sandbox does not constrain conversion work roots");
requireMatch(soffice, /absolute argument escapes the private conversion root/u, "document sandbox does not reject escaping absolute tool arguments");
forbidMatch(soffice, /exec \/usr\/bin\/(?:soffice|pdfinfo|pdftoppm|pdftotext|qpdf) "\$@"/u, "document sandbox has an unsandboxed execution fallback");

const requiredRuntimeKeys = [
  "AIBRAIN_SESSION_SECRET",
  "AIBRAIN_AUTH_CHALLENGE_SECRET",
  "AIBRAIN_PUBLICATION_SECRET",
  "AIBRAIN_BROWSER_GATEWAY_SECRET",
  "AIBRAIN_MAINTENANCE_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "AIBRAIN_CHROME_EXPECTED_VERSION",
  "AIBRAIN_DOCUMENT_MAX_CONVERSIONS",
  "AIBRAIN_DOCUMENT_RETRY_AFTER_MS",
  "AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS",
  "AIBRAIN_DOCUMENT_WORST_CASE_ACTIVE_BYTES",
  "AIBRAIN_DOCUMENT_STORAGE_RETRY_AFTER_MS",
  "AIBRAIN_DOCUMENT_TEMP_GRACE_MS",
  "AIBRAIN_PUBLICATION_CANDIDATE_RETENTION_MS",
];
for (const key of requiredRuntimeKeys) requireMatch(runtimeEnv, new RegExp(`^${key}=`, "mu"), `runtime env example is missing ${key}`);
forbidMatch(runtimeEnv, /SUPABASE_SECRET_KEY/u, "runtime env includes an unnecessary Supabase server key");
for (const key of [
  "AIBRAIN_INSTALLATION_ID",
  "AIBRAIN_HOST_ROOT",
  "AIBRAIN_BACKUP_VOLUME_NAME",
  "AIBRAIN_RESTORE_VOLUME_NAME",
  "AIBRAIN_REVISION",
  "AIBRAIN_EGRESS_IMAGE",
  "AIBRAIN_EGRESS_ENV_FILE",
  "AIBRAIN_ALERTS_ENV_FILE",
  "AIBRAIN_EGRESS_NETWORK_NAME",
  "AIBRAIN_REPLICA_ENV_FILE",
  "AIBRAIN_REPLICA_STATE_HOST_PATH",
  "AIBRAIN_RESTIC_PASSWORD_FILE_HOST",
]) requireMatch(composeEnv, new RegExp(`^${key}=`, "mu"), `compose env example is missing ${key}`);
requireMatch(replicaEnv, /^AIBRAIN_RESTIC_REPOSITORY=(?:s3:https:\/\/|rest:https:\/\/|b2:|azure:|gs:)/mu, "replica env does not use an approved off-host Restic backend");
for (const key of [
  "AIBRAIN_EGRESS_BROWSER_TOKEN",
  "AIBRAIN_EGRESS_WORKER_TOKEN",
  "AIBRAIN_EGRESS_SERVER_TOKEN",
  "AIBRAIN_EGRESS_WORKER_HOSTS",
  "AIBRAIN_EGRESS_SUPABASE_ORIGIN",
]) requireMatch(egressEnv, new RegExp(`^${key}=`, "mu"), `egress env example is missing ${key}`);
forbidMatch(compose, /^\s*(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*:/mu, "Compose broadly injects proxy credentials instead of channel-specific runtime wiring");

const expectedPaths = {
  dataRoot: "/var/lib/aibrain/data",
  companyContextRoot: "/var/lib/aibrain/data/company-context",
  usersRoot: "/var/lib/aibrain/data/users",
  sourceReadRoot: "/srv/aibrain/source-ro",
  publishWriteRoot: "/srv/aibrain/publish-rw",
  backupsRoot: "/var/lib/aibrain/data/backups",
};
if (installation.schemaVersion !== 1) failures.push("installation QA example has the wrong schemaVersion");
for (const [key, value] of Object.entries(expectedPaths)) {
  if (installation.paths?.[key] !== value) failures.push(`installation QA paths.${key} does not match Compose`);
}

for (const script of [
  "infra/hetzner/app/entrypoint.sh",
  "infra/hetzner/app/worker-sandbox.sh",
  "infra/hetzner/app/browser-sandbox.sh",
  "infra/hetzner/app/soffice-safe.sh",
  "infra/hetzner/app/backup.sh",
]) {
  try {
    execFileSync(script.endsWith("soffice-safe.sh") ? "bash" : "sh", ["-n", relative(script)], { stdio: "pipe" });
  } catch {
    failures.push(`${script} does not pass sh -n`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Infrastructure validation failed (${failures.length}):\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Static Docker/Compose boundary validation: PASS\n");
process.stdout.write("Private inherited Chrome CDP pipe (no TCP endpoint): PASS\n");
process.stdout.write("Pinned base image, Debian snapshot and Node toolchain: PASS\n");
if (existsSync("/usr/local/bin/docker") || existsSync("/usr/bin/docker") || existsSync("/opt/homebrew/bin/docker")) {
  try {
    execFileSync("docker", [
      "compose",
      "--env-file", "compose.env.example",
      "-f", "compose.yaml",
      "config", "--no-env-resolution", "--quiet",
    ], {
      cwd: relative("infra/hetzner"),
      stdio: "inherit",
      env: {
        ...process.env,
        AIBRAIN_RUNTIME_ENV_FILE: "ci.env.placeholder",
        AIBRAIN_EGRESS_ENV_FILE: "ci.env.placeholder",
        AIBRAIN_ALERTS_ENV_FILE: "ci.env.placeholder",
        AIBRAIN_REPLICA_ENV_FILE: "ci.env.placeholder",
      },
    });
    process.stdout.write("docker compose config: PASS\n");
  } catch {
    process.stderr.write("docker compose config: FAIL\n");
    process.exit(1);
  }
} else {
  process.stdout.write("docker compose config: NOT RUN (Docker CLI unavailable)\n");
}
