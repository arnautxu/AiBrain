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
const worker = read("infra/hetzner/app/worker-sandbox.sh");
const backup = read("infra/hetzner/app/backup.sh");
const entrypoint = read("infra/hetzner/app/entrypoint.sh");
const soffice = read("infra/hetzner/app/soffice-safe.sh");
const healthcheck = read("infra/hetzner/app/healthcheck.mjs");
const runtimeEnv = read("infra/hetzner/aibrain.env.example");
const composeEnv = read("infra/hetzner/compose.env.example");
const installation = JSON.parse(read("infra/hetzner/installation.qa.example.json"));
const productionRunbook = read("docs/PRODUCTION.md");
const deployArtifacts = [dockerfile, compose, worker, backup, entrypoint, soffice, runtimeEnv, composeEnv].join("\n");

forbidMatch([compose, runtimeEnv, composeEnv].join("\n"), /\b(?:Arnay|studio|operations)\b/iu, "Compose/env artifacts contain a tenant/user hardcode");
forbidMatch(dockerfile, /\/(?:codex|workspaces|computer)\/(?:studio|operations)(?:\/|\s|$)/iu, "Dockerfile contains a tenant/user filesystem hardcode");
forbidMatch(deployArtifacts, /docker\.sock/iu, "deployment artifacts reference docker.sock");
forbidMatch(compose, /^\s*privileged\s*:/mu, "Compose enables privileged mode");
forbidMatch(compose, /^\s*network_mode\s*:/mu, "Compose joins another network namespace");
forbidMatch(compose, /^\s*external\s*:\s*true/mu, "Compose reuses an external network or volume");

requireMatch(dockerfile, /ARG CODEX_VERSION=0\.149\.1/u, "Dockerfile does not pin the approved Codex version");
requireMatch(dockerfile, /ARG NODE_IMAGE=node:24\.18\.1-bookworm-slim@sha256:[0-9a-f]{64}/u, "Dockerfile does not pin the reviewed Node 24 runtime digest");
requireMatch(dockerfile, /ARG DEBIAN_SNAPSHOT=\d{8}T\d{6}Z/u, "Dockerfile does not pin an immutable Debian snapshot");
requireMatch(dockerfile, /snapshot\.debian\.org\/archive\/debian\/\$\{DEBIAN_SNAPSHOT\}/u, "Dockerfile APT source is not the pinned Debian snapshot");
requireMatch(dockerfile, /snapshot\.debian\.org\/archive\/debian-security\/\$\{DEBIAN_SNAPSHOT\}/u, "Dockerfile security APT source is not the pinned Debian snapshot");
requireMatch(dockerfile, /USER aibrain:aibrain/u, "Dockerfile final process is not non-root");
requireMatch(dockerfile, /\bbubblewrap\b/u, "Dockerfile does not install the worker mount sandbox");
for (const tool of ["libreoffice-writer", "libreoffice-calc", "libreoffice-impress", "poppler-utils", "qpdf", "chromium"]) {
  requireMatch(dockerfile, new RegExp(`\\b${tool}\\b`, "u"), `Dockerfile is missing ${tool}`);
}
requireMatch(dockerfile, /CODEX_BIN=\/usr\/local\/bin\/aibrain-codex-worker/u, "Codex does not default to the sandbox launcher");

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
requireMatch(compose, /name: "\$\{AIBRAIN_DATA_VOLUME_NAME:\?/u, "data volume name is not required per installation");
requireMatch(compose, /name: "\$\{AIBRAIN_RESTORE_VOLUME_NAME:\?/u, "restore volume name is not required per installation");
requireMatch(compose, /127\.0\.0\.1/u, "default HTTP binding is not loopback");
requireMatch(compose, /test: \[CMD, node, \/usr\/local\/share\/aibrain\/healthcheck\.mjs\]/u, "Compose does not use the storage-aware healthcheck");

requireMatch(worker, /--ro-bind \/ \/[\s\S]*--tmpfs "\$publish_root"[\s\S]*--remount-ro "\$publish_root"/u, "worker does not mask publish-rw behind a read-only mount");
requireMatch(worker, /--tmpfs "\$data_root"[\s\S]*--ro-bind "\$company_root" "\$company_root"[\s\S]*--ro-bind "\$source_root" "\$source_root"/u, "worker does not hide product data before re-exposing approved read roots");
requireMatch(worker, /company context root is outside dataRoot[\s\S]*users root is outside dataRoot[\s\S]*employee root is outside usersRoot/u, "worker does not fail closed on configured root containment");
for (const contextFile of ["PROFILE.md", "PREFERENCES.md", "PERMISSIONS.md"]) {
  requireMatch(worker, new RegExp(`--ro-bind "\\$user_root/${contextFile}" "\\$user_root/${contextFile}"`, "u"), `worker sandbox is missing private ${contextFile}`);
}
for (const writable of ["runtime_root", "workspace", "staging_root", "artifacts_root", "transport_audit_root"]) {
  requireMatch(worker, new RegExp(`--bind "\\$${writable}" "\\$${writable}"`, "u"), `worker sandbox is missing its declared ${writable} write root`);
}
forbidMatch(worker, /--bind "\$publish_root"/u, "worker sandbox exposes publish-rw as a real writable bind");
requireMatch(entrypoint, /bubblewrap worker isolation is unavailable/u, "entrypoint does not fail closed when worker isolation is unavailable");
requireMatch(entrypoint, /--tmpfs \/var\/lib\/aibrain\/data[\s\S]*--ro-bind \/var\/lib\/aibrain\/data\/company-context \/var\/lib\/aibrain\/data\/company-context/u, "entrypoint does not exercise the worker data visibility boundary");
requireMatch(entrypoint, /source-ro is missing or writable/u, "entrypoint does not verify the source-ro mount");
requireMatch(healthcheck, /docker\.sock[\s\S]*127\.0\.0\.1:3000\/api\/health\/ready/u, "healthcheck does not verify socket absence and loopback readiness");
requireMatch(productionRunbook, /Riesgos P0[\s\S]*namespace de red/u, "production runbook does not disclose the browser network gap");
requireMatch(soffice, /MacroSecurityLevel[\s\S]*<value>3<\/value>/u, "LibreOffice wrapper does not enforce Very High macro security");
for (const flag of ["--headless", "--safe-mode", "--norestore"]) {
  requireMatch(soffice, new RegExp(flag, "u"), `LibreOffice wrapper does not require ${flag}`);
}

const requiredRuntimeKeys = [
  "AIBRAIN_SESSION_SECRET",
  "AIBRAIN_AUTH_CHALLENGE_SECRET",
  "AIBRAIN_PUBLICATION_SECRET",
  "AIBRAIN_BROWSER_GATEWAY_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "AIBRAIN_CHROME_EXPECTED_VERSION",
];
for (const key of requiredRuntimeKeys) requireMatch(runtimeEnv, new RegExp(`^${key}=`, "mu"), `runtime env example is missing ${key}`);
forbidMatch(runtimeEnv, /SUPABASE_SECRET_KEY/u, "runtime env includes an unnecessary Supabase server key");

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
  "infra/hetzner/app/soffice-safe.sh",
  "infra/hetzner/app/backup.sh",
]) {
  try {
    execFileSync("sh", ["-n", relative(script)], { stdio: "pipe" });
  } catch {
    failures.push(`${script} does not pass sh -n`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Infrastructure validation failed (${failures.length}):\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Static Docker/Compose boundary validation: PASS\n");
process.stdout.write("P0 OPEN: browser/CDP still shares the app network namespace with workers\n");
process.stdout.write("Pinned base image, Debian snapshot and Node toolchain: PASS\n");
if (existsSync("/usr/local/bin/docker") || existsSync("/usr/bin/docker") || existsSync("/opt/homebrew/bin/docker")) {
  try {
    execFileSync("docker", [
      "compose",
      "--env-file", "compose.env.example",
      "-f", "compose.yaml",
      "config", "--quiet",
    ], { cwd: relative("infra/hetzner"), stdio: "inherit" });
    process.stdout.write("docker compose config: PASS\n");
  } catch {
    process.stderr.write("docker compose config: FAIL\n");
    process.exit(1);
  }
} else {
  process.stdout.write("docker compose config: NOT RUN (Docker CLI unavailable)\n");
}
