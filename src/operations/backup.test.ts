import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupError, FileBackupService } from "@/operations/backup";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-backup-"));
  roots.push(root);
  const dataRoot = path.join(root, "live-data");
  const backupsRoot = path.join(dataRoot, "backups");
  await Promise.all([
    mkdir(path.join(dataRoot, "users", "user-one", "state"), { recursive: true }),
    mkdir(path.join(dataRoot, "users", "user-one", "browser", "profile", "Default"), { recursive: true }),
    mkdir(path.join(dataRoot, "users", "user-one", "browser", "downloads"), { recursive: true }),
    mkdir(path.join(dataRoot, "users", "user-one", "runtime", "codex-home"), { recursive: true }),
    mkdir(path.join(dataRoot, "sessions", "records"), { recursive: true }),
    mkdir(path.join(dataRoot, "auth-challenges", "records"), { recursive: true }),
    mkdir(path.join(dataRoot, "auth-rate-limits"), { recursive: true }),
    mkdir(path.join(dataRoot, "secrets"), { recursive: true }),
    mkdir(path.join(dataRoot, "locks", "ephemeral.lock"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(dataRoot, "users", "user-one", "state", "project.json"), "project-v1\n"),
    writeFile(path.join(dataRoot, "users", "user-one", "browser", "session.json"), "browser-state\n"),
    writeFile(path.join(dataRoot, "users", "user-one", "browser", "downloads", "report.txt"), "report\n"),
    writeFile(path.join(dataRoot, "users", "user-one", "browser", "profile", "Default", "Cookies"), "cookie-secret\n"),
    writeFile(path.join(dataRoot, "users", "user-one", "runtime", "codex-home", "auth.json"), "codex-secret\n"),
    writeFile(path.join(dataRoot, "sessions", "records", "session.json"), "session-v1\n"),
    writeFile(path.join(dataRoot, "auth-challenges", "records", "challenge.json"), "challenge-secret\n"),
    writeFile(path.join(dataRoot, "auth-rate-limits", "login.json"), "opaque-rate-limit-state\n"),
    writeFile(path.join(dataRoot, "secrets", "service.key"), "service-secret\n"),
    writeFile(path.join(dataRoot, ".env.runtime"), "runtime-secret\n"),
    writeFile(path.join(dataRoot, "PERMISSIONS.md"), "permission-v1\n", { mode: 0o400 }),
    writeFile(path.join(dataRoot, "locks", "ephemeral.lock", "owner.json"), "ephemeral\n"),
  ]);
  return {
    root,
    dataRoot,
    backupsRoot,
    service: new FileBackupService(
      dataRoot,
      backupsRoot,
      "synthetic-company-qa",
      () => Date.parse("2026-08-27T12:34:56.000Z"),
    ),
  };
}

afterEach(async () => {
  async function makeWritable(directory: string) {
    let entries;
    try {
      await chmod(directory, 0o700);
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) =>
      makeWritable(path.join(directory, entry.name))));
  }
  await Promise.all(roots.splice(0).map(async (root) => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }));
});

describe("FileBackupService", () => {
  it("creates an immutable verified snapshot and restores it into a new root", async () => {
    const { root, dataRoot, service } = await fixture();
    const created = await service.create();
    expect(created.manifest.files.map(({ path: filePath }) => filePath)).toEqual([
      "PERMISSIONS.md",
      "users/user-one/browser/downloads/report.txt",
      "users/user-one/browser/session.json",
      "users/user-one/state/project.json",
    ]);
    expect((await lstat(created.snapshotRoot)).mode & 0o777).toBe(0o500);
    expect((await lstat(path.join(created.snapshotRoot, "manifest.json"))).mode & 0o777).toBe(0o400);
    await expect(service.verify(created.snapshotRoot)).resolves.toEqual(created.manifest);

    await writeFile(path.join(dataRoot, "users", "user-one", "state", "project.json"), "project-v2\n");
    const restoreRoot = path.join(root, "restored-data");
    const restored = await service.restore(created.snapshotRoot, restoreRoot);
    expect(restored.manifest.sourceFingerprint).toBe(created.manifest.sourceFingerprint);
    expect(await readFile(path.join(restoreRoot, "users", "user-one", "state", "project.json"), "utf8"))
      .toBe("project-v1\n");
    await expect(lstat(path.join(restoreRoot, "sessions"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(restoreRoot, "auth-challenges"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(restoreRoot, "auth-rate-limits"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(restoreRoot, "secrets"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(restoreRoot, ".env.runtime"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(restoreRoot, "users", "user-one", "browser", "profile")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(restoreRoot, "users", "user-one", "runtime", "codex-home", "auth.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(restoreRoot, "locks"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects snapshot corruption and refuses an existing restore destination", async () => {
    const { root, service } = await fixture();
    const created = await service.create();
    const target = path.join(created.snapshotRoot, "data", "users", "user-one", "state", "project.json");
    await chmod(path.dirname(target), 0o700);
    await chmod(target, 0o600);
    await writeFile(target, "tampered\n");
    await expect(service.verify(created.snapshotRoot)).rejects.toMatchObject({
      code: "BACKUP_INTEGRITY_FAILED",
    });

    const existing = path.join(root, "existing");
    await mkdir(existing);
    await expect(service.restore(created.snapshotRoot, existing)).rejects.toMatchObject({
      code: "RESTORE_DESTINATION_EXISTS",
    });
  });

  it("fails closed on symbolic links in live state", async () => {
    const { root, dataRoot, service } = await fixture();
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "outside\n");
    await symlink(outside, path.join(dataRoot, "users", "user-one", "state", "linked.txt"));
    await expect(service.create()).rejects.toBeInstanceOf(BackupError);
    await expect(service.create()).rejects.toMatchObject({ code: "BACKUP_SYMLINK_REJECTED" });
  });
});
