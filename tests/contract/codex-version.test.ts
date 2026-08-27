import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const pinnedVersion = "0.149.1";

describe("pinned Codex App Server contract", () => {
  it("pins the worker binary to the generated contract version", async () => {
    const [dockerfile, packageJson] = await Promise.all([
      readFile(path.join(repositoryRoot, "Dockerfile"), "utf8"),
      readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    ]);
    expect(dockerfile).toContain(`ARG CODEX_VERSION=${pinnedVersion}`);
    expect(dockerfile).toContain('"@openai/codex@${CODEX_VERSION}"');
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;
    expect(scripts["contracts:generate"]).toContain(`@openai/codex@${pinnedVersion}`);
  });

  it("contains the aggregate request and event schemas used by the transport", async () => {
    const contractRoot = path.join(repositoryRoot, "contracts", "codex", pinnedVersion);
    const [clientRequest, serverRequest, serverNotification, generatedType] = await Promise.all([
      readFile(path.join(contractRoot, "schema", "ClientRequest.json"), "utf8"),
      readFile(path.join(contractRoot, "schema", "ServerRequest.json"), "utf8"),
      readFile(path.join(contractRoot, "schema", "ServerNotification.json"), "utf8"),
      readFile(path.join(contractRoot, "types", "ClientRequest.ts"), "utf8"),
    ]);

    expect(JSON.parse(clientRequest)).toMatchObject({ $schema: expect.any(String) });
    expect(JSON.parse(serverRequest)).toMatchObject({ $schema: expect.any(String) });
    expect(JSON.parse(serverNotification)).toMatchObject({ $schema: expect.any(String) });
    expect(generatedType).toContain("export type ClientRequest");
  });
});
