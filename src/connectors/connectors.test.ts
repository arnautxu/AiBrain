import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorError,
  ConnectorRegistry,
  FileConnectorBindingStore,
  assertAuthorizationFresh,
  assertBindingAccess,
  credentialBindingFingerprint,
  prepareConnectorAuthorization,
  type ConnectorCredentialProvider,
  type ConnectorDefinition,
  type ConnectorPrincipal,
  type CredentialBinding,
} from "@/connectors";

const INSTALLATION_ID = "example-lab";
const USER_ONE = "00000000-0000-4000-8000-000000000001";
const USER_TWO = "00000000-0000-4000-8000-000000000002";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const roots: string[] = [];

const principal = (userId = USER_ONE): ConnectorPrincipal => ({
  installationId: INSTALLATION_ID,
  userId,
  roleId: "workspace-member",
});

const definition: ConnectorDefinition = {
  id: "google-drive",
  label: "Google Drive",
  operations: [
    { id: "read-file", requiredScopes: ["https://www.googleapis.com/auth/drive.file"], mutating: false, approval: "never" },
    { id: "create-file", requiredScopes: ["https://www.googleapis.com/auth/drive.file"], mutating: true, approval: "required" },
  ],
};

const binding = (overrides: Partial<CredentialBinding> = {}): CredentialBinding => ({
  schemaVersion: 1,
  connectorId: "google-drive",
  credentialRef: "vault://example-lab/users/user-one/google-drive",
  installationId: INSTALLATION_ID,
  userId: USER_ONE,
  scopes: ["https://www.googleapis.com/auth/drive.file"],
  status: "active",
  version: 1,
  ...overrides,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-connectors-"));
  roots.push(root);
  const dataRoot = path.join(root, "data");
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  return {
    root,
    dataRoot,
    store: new FileConnectorBindingStore(INSTALLATION_ID, dataRoot),
  };
}

class Provider implements ConnectorCredentialProvider {
  inspect = vi.fn(async ({ binding: current }: { principal: ConnectorPrincipal; binding: CredentialBinding }) => ({
    handle: {
      handleId: `handle:${current.connectorId}`,
      bindingFingerprint: credentialBindingFingerprint(current),
      bindingVersion: current.version,
    },
    health: { status: "connected" as const, checkedAt: "2026-08-28T10:00:00.000Z", code: null },
  }));

  revoke = vi.fn(async () => undefined);
}

describe("connector credential bindings", () => {
  it("binds metadata to one installation/user and permits shared bindings only explicitly", async () => {
    const { dataRoot, store } = await fixture();
    await store.put(binding());

    await expect(store.resolve(principal(), "google-drive", { allowShared: false }))
      .resolves.toMatchObject({ userId: USER_ONE, status: "active" });
    await expect(store.resolve(principal(USER_TWO), "google-drive", { allowShared: false }))
      .rejects.toMatchObject({ code: "CONNECTOR_BINDING_NOT_FOUND" });
    expect(() => assertBindingAccess(principal(USER_TWO), binding(), { allowShared: false }))
      .toThrowError(expect.objectContaining({ code: "CONNECTOR_BINDING_USER_MISMATCH" }));

    const shared = binding({ userId: null, credentialRef: "vault://example-lab/shared/google-drive", version: 1 });
    await store.put(shared);
    await expect(store.resolve(principal(USER_TWO), "google-drive", { allowShared: false }))
      .rejects.toMatchObject({ code: "CONNECTOR_BINDING_NOT_FOUND" });
    await expect(store.resolve(principal(USER_TWO), "google-drive", { allowShared: true }))
      .resolves.toMatchObject({ userId: null });
    await expect(store.put(binding({ installationId: "other-company" })))
      .rejects.toMatchObject({ code: "CONNECTOR_BINDING_INSTALLATION_MISMATCH" });

    const stored = path.join(dataRoot, "connectors", "bindings", INSTALLATION_ID, USER_ONE, "google-drive.json");
    expect((await stat(stored)).mode & 0o777).toBe(0o600);
    expect(await readFile(stored, "utf8")).not.toContain("access_token");
    expect(await readFile(stored, "utf8")).not.toContain("refresh_token");
  });

  it("requires monotonic versions and exact authority to revoke shared credentials", async () => {
    const { store } = await fixture();
    await store.put(binding({ userId: null, credentialRef: "vault://example-lab/shared/google-drive" }));
    await expect(store.put(binding({ userId: null, credentialRef: "vault://example-lab/shared/google-drive" })))
      .rejects.toMatchObject({ code: "CONNECTOR_BINDING_VERSION_CONFLICT" });
    await expect(store.revoke(principal(), "google-drive", {
      allowShared: true,
      manageShared: false,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: "CONNECTOR_SHARED_BINDING_MANAGEMENT_DENIED" });
    await expect(store.revoke(principal(), "google-drive", {
      allowShared: true,
      manageShared: true,
      expectedVersion: 1,
    })).resolves.toMatchObject({ status: "revoked", version: 2 });
  });
});

describe("connector authorization snapshots", () => {
  it("canonically binds identity, scopes, arguments and policy fingerprints", () => {
    const first = prepareConnectorAuthorization({
      principal: principal(),
      definition,
      binding: binding(),
      operation: "create-file",
      resourceId: null,
      args: { mimeType: "text/plain", name: "AiBrain connector acceptance.txt" },
      permissionFingerprint: SHA_A,
      workspacePolicyFingerprint: SHA_B,
      allowSharedCredential: false,
      now: () => Date.parse("2026-08-28T10:00:00.000Z"),
    });
    const reordered = prepareConnectorAuthorization({
      principal: principal(),
      definition,
      binding: binding(),
      operation: "create-file",
      resourceId: null,
      args: { name: "AiBrain connector acceptance.txt", mimeType: "text/plain" },
      permissionFingerprint: SHA_A,
      workspacePolicyFingerprint: SHA_B,
      allowSharedCredential: false,
      now: () => Date.parse("2026-08-28T10:00:00.000Z"),
    });
    expect(first.mutating).toBe(true);
    expect(first.argsHash).toBe(reordered.argsHash);
    expect(first.authorizationFingerprint).toBe(reordered.authorizationFingerprint);
    expect(first.authorizationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(() => assertAuthorizationFresh(first, binding(), () => Date.parse("2026-08-28T10:01:00.000Z")))
      .not.toThrow();
  });

  it("fails closed for cross-user, missing scope, expiry, tampering and binding rotation", () => {
    const base = {
      principal: principal(),
      definition,
      binding: binding(),
      operation: "read-file",
      resourceId: "drive-file-one",
      args: { fields: ["id", "name"] },
      permissionFingerprint: SHA_A,
      workspacePolicyFingerprint: SHA_B,
      allowSharedCredential: false,
      now: () => Date.parse("2026-08-28T10:00:00.000Z"),
    };
    expect(() => prepareConnectorAuthorization({ ...base, principal: principal(USER_TWO) }))
      .toThrowError(expect.objectContaining({ code: "CONNECTOR_BINDING_USER_MISMATCH" }));
    expect(() => prepareConnectorAuthorization({ ...base, binding: binding({ scopes: ["scope:unrelated"] }) }))
      .toThrowError(expect.objectContaining({ code: "CONNECTOR_SCOPE_MISSING" }));
    const snapshot = prepareConnectorAuthorization(base);
    expect(() => assertAuthorizationFresh(snapshot, binding(), () => Date.parse("2026-08-28T10:03:00.000Z")))
      .toThrowError(expect.objectContaining({ code: "CONNECTOR_AUTHORIZATION_EXPIRED" }));
    expect(() => assertAuthorizationFresh({ ...snapshot, resourceId: "other-file" }, binding()))
      .toThrowError(expect.objectContaining({ code: "CONNECTOR_AUTHORIZATION_TAMPERED" }));
    expect(() => assertAuthorizationFresh(
      snapshot,
      binding({ version: 2 }),
      () => Date.parse("2026-08-28T10:01:00.000Z"),
    ))
      .toThrowError(expect.objectContaining({ code: "CONNECTOR_BINDING_CHANGED" }));
  });
});

describe("ConnectorRegistry", () => {
  it("shows only registered connectors and never advertises an unbound provider", async () => {
    const { store } = await fixture();
    const provider = new Provider();
    const empty = new ConnectorRegistry(store);
    expect(empty.definitions()).toEqual([]);
    await expect(empty.capabilities(principal(), { allowSharedCredentials: false })).resolves.toEqual([]);

    const registry = new ConnectorRegistry(store, [{ definition, credentialProvider: provider }]);
    const capabilities = await registry.capabilities(principal(), { allowSharedCredentials: false });
    expect(capabilities).toEqual([expect.objectContaining({
      connectorId: "google-drive",
      status: "not_configured",
      effectiveOperations: [],
    })]);
    expect(provider.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(capabilities)).not.toContain("credentialRef");
    expect(JSON.stringify(capabilities)).not.toContain("vault://");
  });

  it("derives capabilities from binding scopes plus live provider health", async () => {
    const { store } = await fixture();
    await store.put(binding());
    const provider = new Provider();
    const registry = new ConnectorRegistry(store, [{ definition, credentialProvider: provider }]);
    await expect(registry.capabilities(principal(), { allowSharedCredentials: false }))
      .resolves.toEqual([expect.objectContaining({
        status: "connected",
        effectiveOperations: ["read-file", "create-file"],
        approvalRequiredOperations: ["create-file"],
      })]);
    expect(provider.inspect).toHaveBeenCalledTimes(1);

    provider.inspect.mockResolvedValueOnce({
      handle: {
        handleId: "wrong",
        bindingFingerprint: "c".repeat(64),
        bindingVersion: 1,
      },
      health: { status: "connected", checkedAt: "2026-08-28T10:00:00.000Z", code: null },
    });
    await expect(registry.capabilities(principal(), { allowSharedCredentials: false }))
      .resolves.toEqual([expect.objectContaining({
        status: "degraded",
        statusCode: "CONNECTOR_HANDLE_BINDING_MISMATCH",
        effectiveOperations: [],
      })]);
  });

  it("revokes locally before reporting an explicit provider revoke failure", async () => {
    const { store } = await fixture();
    await store.put(binding());
    const provider = new Provider();
    provider.revoke.mockRejectedValueOnce(new ConnectorError("PROVIDER_REVOKE_FAILED", "Provider unavailable."));
    const registry = new ConnectorRegistry(store, [{ definition, credentialProvider: provider }]);
    const result = await registry.revoke({
      principal: principal(),
      connectorId: "google-drive",
      allowSharedCredential: false,
      manageSharedCredential: false,
      expectedVersion: 1,
    });
    expect(result).toMatchObject({
      providerRevoked: false,
      errorCode: "PROVIDER_REVOKE_FAILED",
      binding: { status: "revoked", version: 2 },
    });
    await expect(registry.capabilities(principal(), { allowSharedCredentials: false }))
      .resolves.toEqual([expect.objectContaining({
        status: "revoked",
        effectiveOperations: [],
      })]);
  });
});
