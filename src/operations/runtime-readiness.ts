import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { ReadinessComponentProbe, ReadinessComponentResult } from "@/operations/readiness";

const execFileAsync = promisify(execFile);
const EXACT_CODEX_VERSION = "0.149.1";
const CHROME_VERSION = /^\d+\.\d+\.\d+\.\d+$/u;

type RuntimeReadinessDependencies = Readonly<{
  executable(path: string): Promise<boolean>;
  version(path: string, args: readonly string[], signal: AbortSignal): Promise<string>;
}>;

const defaults: RuntimeReadinessDependencies = {
  async executable(executablePath) {
    try {
      await access(executablePath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  async version(executablePath, args, signal) {
    const result = await execFileAsync(executablePath, [...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024,
      signal,
      timeout: 1_500,
    });
    return `${result.stdout}${result.stderr}`.trim();
  },
};

function ready(code = "OK"): ReadinessComponentResult {
  return { status: "ready", code };
}

function unavailable(code: string): ReadinessComponentResult {
  return { status: "unavailable", code };
}

async function allExecutable(paths: readonly string[], dependencies: RuntimeReadinessDependencies) {
  const available = await Promise.all(paths.map((candidate) => dependencies.executable(candidate)));
  return available.every(Boolean);
}

export function runtimeReadinessProbes(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: RuntimeReadinessDependencies = defaults,
): readonly ReadinessComponentProbe[] {
  const codexReal = "/usr/local/bin/codex-real";
  const workerSandbox = environment.CODEX_BIN?.trim() || "/usr/local/bin/aibrain-codex-worker";
  const browserSandbox = environment.AIBRAIN_CHROME_BIN?.trim() || "/usr/local/bin/aibrain-chrome";
  const chromiumReal = "/usr/bin/chromium";
  const expectedChrome = environment.AIBRAIN_CHROME_EXPECTED_VERSION?.trim() || "";
  const documentExecutables = [
    environment.AIBRAIN_SOFFICE_BIN?.trim() || "/usr/local/bin/aibrain-soffice",
    environment.AIBRAIN_PDFINFO_BIN?.trim() || "/usr/bin/pdfinfo",
    environment.AIBRAIN_PDFTOPPM_BIN?.trim() || "/usr/bin/pdftoppm",
    environment.AIBRAIN_QPDF_BIN?.trim() || "/usr/bin/qpdf",
  ];

  return Object.freeze([
    {
      name: "codex-toolchain",
      required: true,
      async check(signal: AbortSignal) {
        if (!await allExecutable([codexReal, workerSandbox, "/usr/bin/bwrap"], dependencies)) {
          return unavailable("CODEX_EXECUTABLE_UNAVAILABLE");
        }
        const version = await dependencies.version(codexReal, ["--version"], signal);
        return version === `codex-cli ${EXACT_CODEX_VERSION}`
          ? ready()
          : unavailable("CODEX_VERSION_MISMATCH");
      },
    },
    {
      name: "browser-toolchain",
      required: true,
      async check(signal: AbortSignal) {
        if (!CHROME_VERSION.test(expectedChrome)) return unavailable("CHROME_VERSION_REQUIRED");
        if (!await allExecutable([browserSandbox, chromiumReal, "/usr/bin/bwrap"], dependencies)) {
          return unavailable("CHROME_EXECUTABLE_UNAVAILABLE");
        }
        const output = await dependencies.version(chromiumReal, ["--version"], signal);
        const actual = output.match(/(?:Chromium|Google Chrome)[^0-9]*(\d+\.\d+\.\d+\.\d+)/u)?.[1] ?? null;
        return actual === expectedChrome ? ready() : unavailable("CHROME_VERSION_MISMATCH");
      },
    },
    {
      name: "document-toolchain",
      required: true,
      async check() {
        return await allExecutable(documentExecutables, dependencies)
          ? ready()
          : unavailable("DOCUMENT_TOOLCHAIN_UNAVAILABLE");
      },
    },
  ]);
}
