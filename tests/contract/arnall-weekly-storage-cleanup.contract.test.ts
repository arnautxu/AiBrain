import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cleanupPath = path.join(process.cwd(), "infra", "hetzner", "app", "arnall-storage-cleanup.sh");
const servicePath = path.join(process.cwd(), "infra", "hetzner", "systemd", "aibrain-arnall-storage-cleanup.service");
const timerPath = path.join(process.cwd(), "infra", "hetzner", "systemd", "aibrain-arnall-storage-cleanup.timer");
const logrotatePath = path.join(process.cwd(), "infra", "hetzner", "systemd", "aibrain-arnall-storage-cleanup.logrotate");

describe("Arnall weekly host cleanup contract", () => {
  it("defaults to dry-run and requires an explicit execute flag", async () => {
    const source = await readFile(cleanupPath, "utf8");

    expect(source).toContain('mode="dry-run"');
    expect(source).toContain('--execute) mode="execute"');
    expect(source).toContain('[[ "$mode" == "execute" ]]');
  });

  it("has a fixed Arnall allowlist and no broad prune or volume deletion", async () => {
    const source = await readFile(cleanupPath, "utf8");

    expect(source).toContain('readonly INSTALLATION_ID="company-qa"');
    expect(source).toContain('readonly COMPOSE_PROJECT="aibrain-company-qa"');
    expect(source).toContain('"$STORAGE_ROOT/quarantine" "$STORAGE_ROOT/failed-releases" "$STORAGE_ROOT/incoming"');
    expect(source).toContain("is_protected_image");
    expect(source).toContain("image_id_is_protected");
    expect(source).toContain("now - created_epoch < MIN_AGE_DAYS * 86400");
    expect(source).toContain("release-staging-contains-git");
    expect(source).not.toMatch(/docker\s+(?:system|builder|image|volume)\s+prune/u);
    expect(source).not.toMatch(/docker\s+volume\s+(?:rm|prune)/u);
    expect(source).not.toContain("/opt/bgreenly");
  });

  it("holds cleanup and deploy locks and checks release health before and after", async () => {
    const source = await readFile(cleanupPath, "utf8");
    const firstHealth = source.indexOf("verify_health", source.indexOf("main()"));
    const cleanup = source.indexOf("cleanup_release_staging", source.indexOf("main()"));
    const lastHealth = source.lastIndexOf("verify_health");

    expect(source).toContain('flock --exclusive --nonblock 9');
    expect(source).toContain('flock --shared --nonblock 8');
    expect(source).toContain('${STATE_FILE}.transaction.json');
    expect(firstHealth).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(firstHealth);
    expect(lastHealth).toBeGreaterThan(cleanup);
  });

  it("runs from a bounded hardened service", async () => {
    const service = await readFile(servicePath, "utf8");

    expect(service).toContain("ExecStart=/usr/local/sbin/aibrain-arnall-storage-cleanup --execute");
    expect(service).toContain("TimeoutStartSec=330");
    expect(service).toContain("IOSchedulingClass=idle");
    expect(service).toContain("CPUQuota=10%");
    expect(service).toContain("ProtectSystem=strict");
    expect(service).toContain("StandardOutput=append:/var/log/aibrain/arnall-storage-cleanup.log");
  });

  it("schedules exactly 04:00 Europe/Madrid on Saturdays", async () => {
    const timer = await readFile(timerPath, "utf8");

    expect(timer).toContain("OnCalendar=Sat *-*-* 04:00:00 Europe/Madrid");
    expect(timer).toContain("AccuracySec=1s");
    expect(timer).toContain("RandomizedDelaySec=0");
    expect(timer).toContain("Persistent=true");
  });

  it("rotates only the dedicated cleanup log", async () => {
    const logrotate = await readFile(logrotatePath, "utf8");

    expect(logrotate).toContain("/var/log/aibrain/arnall-storage-cleanup.log");
    expect(logrotate).toContain("rotate 8");
    expect(logrotate).toContain("maxsize 1M");
    expect(logrotate).not.toContain("/var/log/bgreenly");
  });

  it("has valid shell syntax", () => {
    expect(() => execFileSync("bash", ["-n", cleanupPath], { stdio: "pipe" })).not.toThrow();
  });
});
