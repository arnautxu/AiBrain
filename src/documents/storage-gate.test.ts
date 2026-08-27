import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileDocumentStorageGate } from "@/documents/storage-gate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-document-storage-gate-"));
  roots.push(root);
  return {
    root,
    lockRoot: path.join(root, "locks"),
    capacityRoot: path.join(root, "data"),
  };
}

const GiB = 1024n * 1024n * 1024n;

function capacity(availableBytes: bigint, totalBytes = 100n * GiB) {
  return async () => ({ bavail: availableBytes, blocks: totalBytes, bsize: 1n });
}

describe("installation-wide document storage admission", () => {
  it("reserves the worst case for every simultaneous slot above the free-space floor", async () => {
    const { lockRoot, capacityRoot } = await fixture();
    const gate = new FileDocumentStorageGate({
      rootDirectory: lockRoot,
      capacityRoot,
      maxActiveUploads: 2,
      minimumFreeBytes: Number(GiB),
      minimumFreeRatioPpm: 50_000,
      worstCaseActiveBytes: 512 * 1024 * 1024,
      readCapacity: capacity(7n * GiB),
    });

    await expect(gate.run(() => "admitted")).resolves.toBe("admitted");
  });

  it("fails before invoking the operation when the burst would breach headroom", async () => {
    const { lockRoot, capacityRoot } = await fixture();
    let invoked = false;
    const gate = new FileDocumentStorageGate({
      rootDirectory: lockRoot,
      capacityRoot,
      maxActiveUploads: 2,
      minimumFreeBytes: Number(GiB),
      minimumFreeRatioPpm: 50_000,
      worstCaseActiveBytes: 512 * 1024 * 1024,
      retryAfterMs: 7_500,
      readCapacity: capacity(5n * GiB + 1024n * 1024n * 1024n - 1n),
    });

    await expect(gate.run(() => { invoked = true; })).rejects.toMatchObject({
      code: "DOCUMENT_STORAGE_BACKPRESSURE",
      retryable: true,
      retryAfterMs: 7_500,
      availableBytes: 6n * GiB - 1n,
      requiredBytes: 6n * GiB,
    });
    expect(invoked).toBe(false);
  });

  it("applies active-upload backpressure across independent instances", async () => {
    const { lockRoot, capacityRoot } = await fixture();
    const options = {
      rootDirectory: lockRoot,
      capacityRoot,
      maxActiveUploads: 1,
      minimumFreeBytes: 0,
      minimumFreeRatioPpm: 0,
      worstCaseActiveBytes: 128 * 1024 * 1024,
      readCapacity: capacity(10n * GiB),
    };
    const first = new FileDocumentStorageGate(options);
    const second = new FileDocumentStorageGate(options);
    let started!: () => void;
    let release!: () => void;
    const admitted = new Promise<void>((resolve) => { started = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = first.run(async () => {
      started();
      await held;
      return "first";
    });
    await admitted;

    await expect(second.run(() => "second")).rejects.toMatchObject({
      code: "DOCUMENT_STORAGE_BACKPRESSURE",
    });
    release();
    await expect(running).resolves.toBe("first");
    await expect(second.run(() => "second")).resolves.toBe("second");
  });

  it("fails closed when filesystem capacity cannot be measured", async () => {
    const { lockRoot, capacityRoot } = await fixture();
    const gate = new FileDocumentStorageGate({
      rootDirectory: lockRoot,
      capacityRoot,
      maxActiveUploads: 1,
      minimumFreeBytes: 0,
      minimumFreeRatioPpm: 0,
      worstCaseActiveBytes: 128 * 1024 * 1024,
      readCapacity: async () => { throw new Error("synthetic statfs failure"); },
    });

    await expect(gate.run(() => "unsafe")).rejects.toMatchObject({
      code: "DOCUMENT_STORAGE_CAPACITY_UNAVAILABLE",
    });
    await expect(gate.run(() => "still retryable")).rejects.toMatchObject({
      code: "DOCUMENT_STORAGE_CAPACITY_UNAVAILABLE",
    });
  });

  it("rejects unsafe roots and capacity settings", async () => {
    const { lockRoot, capacityRoot } = await fixture();
    expect(() => new FileDocumentStorageGate({
      rootDirectory: path.parse(lockRoot).root,
      capacityRoot,
    })).toThrow(expect.objectContaining({ code: "DOCUMENT_STORAGE_GATE_INVALID" }));
    expect(() => new FileDocumentStorageGate({
      rootDirectory: lockRoot,
      capacityRoot,
      maxActiveUploads: 65,
    })).toThrow(expect.objectContaining({ code: "DOCUMENT_STORAGE_GATE_INVALID" }));
  });
});
