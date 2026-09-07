import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ installation: vi.fn(), project: vi.fn(), permissions: vi.fn(), roots: vi.fn(), search: vi.fn() }));
vi.mock("@/library/server-resource-access", () => ({ installationForLibraryResource: mocks.installation }));
vi.mock("@/workbench/shared-access", () => ({ resolveProjectAccess: mocks.project }));
vi.mock("@/runtime/permission-turn", () => ({ resolveServerTurnPermissions: mocks.permissions }));
vi.mock("./enterprise-document-network", () => ({ EnterpriseDocumentNetwork: class { rootsForTurn = mocks.roots; } }));
vi.mock("./server-files", () => ({ ServerDocumentFiles: class { search = mocks.search; } }));
import { browseServerForSession } from "./server-browser-service";
const session = { provider: "local" as const, user: { id: "user", email: "qa@example.test", name: "QA" }, tenant: { id: "arnall", name: "Arnall" }, expiresAt: "2099-01-01T00:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.installation.mockResolvedValue({ installationId: "arnall" });
  mocks.project.mockResolvedValue({}); mocks.permissions.mockResolvedValue({}); mocks.roots.mockResolvedValue([]);
});
it("resolves project access before any source request and rejects tenant/project failures", async () => {
  mocks.installation.mockRejectedValueOnce(new Error("tenant denied"));
  await expect(browseServerForSession(session, "foreign", "server:/")).rejects.toThrow();
  expect(mocks.project).not.toHaveBeenCalled();
  mocks.project.mockRejectedValueOnce(new Error("project denied"));
  await expect(browseServerForSession(session, "foreign", "server:/")).rejects.toThrow();
  expect(mocks.permissions).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
});
it("uses only fresh browsing and returns reference metadata without raw Windows paths", async () => {
  mocks.search.mockResolvedValue({ available: true, sourceChecked: true, results: [{ path: "server-arnall/Y/QA%20file.txt", source: "Y:\\QA file.txt", kind: "file", modifiedAt: null, size: 4 }] });
  const result = await browseServerForSession(session, "project", "server:/Y/");
  expect(mocks.search).toHaveBeenCalledWith([], "server:/Y/", 50, true);
  expect(result).toMatchObject({ results: [{ name: "QA file.txt" }] });
  expect(JSON.stringify(result)).not.toContain("Y:\\");
});
