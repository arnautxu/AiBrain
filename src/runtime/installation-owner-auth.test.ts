import { afterEach, describe, expect, it, vi } from "vitest";
import { installationOwnerAuthSocket, readInstallationOwnerAccess } from "./installation-owner-auth";

describe("installation owner auth authorization", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "   "])("leaves ordinary authentication unchanged without a socket: %j", (socket) => {
    expect(installationOwnerAuthSocket("company-qa", { AIBRAIN_CODEX_OWNER_AUTH_SOCKET: socket })).toBeNull();
  });

  it.each(["company-qa", "synthetic-company"])("rejects every configured owner socket for %s despite matching acknowledgments", (installationId) => {
    expect(() => installationOwnerAuthSocket(installationId, {
      AIBRAIN_CODEX_OWNER_AUTH_SOCKET: "/run/synthetic-owner-auth/broker.sock",
      AIBRAIN_CODEX_AUTH_SCOPE: "installation-owner",
      AIBRAIN_INSTALLATION_OWNER_AUTH_ACK: installationId,
    })).toThrow("Installation owner authentication is not authorized.");
  });

  it("cannot obtain owner credentials with or without a configured socket", () => {
    vi.stubEnv("AIBRAIN_CODEX_OWNER_AUTH_SOCKET", "");
    expect(() => readInstallationOwnerAccess("company-qa", "previous-account")).toThrow("Installation owner authentication is unavailable.");
    vi.stubEnv("AIBRAIN_CODEX_OWNER_AUTH_SOCKET", "/run/synthetic-owner-auth/broker.sock");
    expect(() => readInstallationOwnerAccess("company-qa", "previous-account")).toThrow("Installation owner authentication is not authorized.");
  });
});
