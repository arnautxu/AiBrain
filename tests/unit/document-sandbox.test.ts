import { execFile as execFileCallback } from "node:child_process";
import { chmod, copyFile, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const source = path.resolve(process.cwd(), "infra/hetzner/app/soffice-safe.sh");
const launchers = ["soffice", "pdfinfo", "pdftoppm", "pdftotext", "qpdf"] as const;
const roots: string[] = [];

async function launcher(name: typeof launchers[number]) {
  const root = await mkdtemp("/tmp/aibrain-turn-document-");
  roots.push(root);
  const executable = path.join(root, `aibrain-${name}`);
  await copyFile(source, executable);
  await chmod(executable, 0o700);
  return { executable, root };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("document tool filesystem sandbox launcher", () => {
  it.each(launchers)("rejects an absolute path outside private work for %s", async (name) => {
    const test = await launcher(name);
    await expect(execFile(test.executable, ["/etc/passwd"], { cwd: test.root }))
      .rejects.toMatchObject({ code: 78, stderr: expect.stringContaining("absolute argument escapes") });
  });

  it("rejects LibreOffice without every non-interactive safety flag", async () => {
    const test = await launcher("soffice");
    const physicalRoot = await realpath(test.root);
    await expect(execFile(test.executable, [
      `-env:UserInstallation=file://${path.join(physicalRoot, "lo-profile")}`,
      "--headless",
      "--norestore",
    ], { cwd: test.root }))
      .rejects.toMatchObject({ code: 78, stderr: expect.stringContaining("--safe-mode") });
  });

  it("rejects parent traversal before any document tool starts", async () => {
    const test = await launcher("pdfinfo");
    await expect(execFile(test.executable, ["../sibling/document.pdf"], { cwd: test.root }))
      .rejects.toMatchObject({ code: 78, stderr: expect.stringContaining("parent traversal") });
  });
});
