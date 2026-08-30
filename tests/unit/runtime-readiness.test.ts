import { describe, expect, it } from "vitest";
import { runtimeReadinessProbes } from "@/operations/runtime-readiness";

const environment = {
  AIBRAIN_CODEX_APP_SERVER_ACCEPTED: "1",
  CODEX_BIN: "/usr/local/bin/aibrain-codex-worker",
  AIBRAIN_CHROME_BIN: "/usr/local/bin/aibrain-chrome",
  AIBRAIN_CHROME_EXPECTED_VERSION: "140.0.0.0",
  AIBRAIN_SOFFICE_BIN: "/usr/local/bin/aibrain-soffice",
  AIBRAIN_PDFINFO_BIN: "/usr/local/bin/aibrain-pdfinfo",
  AIBRAIN_PDFTOPPM_BIN: "/usr/local/bin/aibrain-pdftoppm",
  AIBRAIN_PDFTOTEXT_BIN: "/usr/local/bin/aibrain-pdftotext",
  AIBRAIN_QPDF_BIN: "/usr/local/bin/aibrain-qpdf",
};

describe("runtime readiness probes", () => {
  it("requires exact Codex/Chromium versions and every execution adapter", async () => {
    const probes = runtimeReadinessProbes(environment, {
      async executable() { return true; },
      async version(executable) {
        return executable.endsWith("codex-real") ? "codex-cli 0.149.1" : "Chromium 140.0.0.0";
      },
    });
    const controller = new AbortController();
    await expect(Promise.all(probes.map((probe) => probe.check(controller.signal))))
      .resolves.toEqual([
        { status: "ready", code: "OK" },
        { status: "ready", code: "OK" },
        { status: "ready", code: "OK" },
      ]);
    expect(probes.every((probe) => probe.required)).toBe(true);
  });

  it("degrades independently for version drift and a missing document executable", async () => {
    const probes = runtimeReadinessProbes(environment, {
      async executable(executable) { return executable !== "/usr/local/bin/aibrain-qpdf"; },
      async version(executable) {
        return executable.endsWith("codex-real") ? "codex-cli 0.150.0" : "Chromium 141.0.0.0";
      },
    });
    const controller = new AbortController();
    await expect(Promise.all(probes.map((probe) => probe.check(controller.signal))))
      .resolves.toEqual([
        { status: "unavailable", code: "CODEX_VERSION_MISMATCH" },
        { status: "unavailable", code: "CHROME_VERSION_MISMATCH" },
        { status: "unavailable", code: "DOCUMENT_TOOLCHAIN_UNAVAILABLE" },
      ]);
  });

  it("stays unavailable until this container startup completed a real App Server handshake", async () => {
    const probes = runtimeReadinessProbes({
      ...environment,
      AIBRAIN_CODEX_APP_SERVER_ACCEPTED: undefined,
    }, {
      async executable() { return true; },
      async version(executable) {
        return executable.endsWith("codex-real") ? "codex-cli 0.149.1" : "Chromium 140.0.0.0";
      },
    });
    const controller = new AbortController();
    await expect(probes[0]?.check(controller.signal)).resolves.toEqual({
      status: "unavailable",
      code: "CODEX_APP_SERVER_ACCEPTANCE_REQUIRED",
    });
  });
});
