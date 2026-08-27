import { statfs } from "node:fs/promises";
import path from "node:path";
import { ResourceLockTimeoutError, StorageError } from "@/storage/errors";
import { ResourceLockManager, type ResourceLockLease } from "@/storage/resource-lock";

const MEBIBYTE = 1024 * 1024;
const DEFAULT_MAX_ACTIVE_UPLOADS = 2;
const DEFAULT_MINIMUM_FREE_BYTES = 1024 * MEBIBYTE;
const DEFAULT_MINIMUM_FREE_RATIO_PPM = 50_000;
const DEFAULT_WORST_CASE_ACTIVE_BYTES = 512 * MEBIBYTE;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const PARTS_PER_MILLION = 1_000_000;

type FilesystemCapacity = {
  bavail: bigint;
  bsize: bigint;
  blocks: bigint;
};

function configuredInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^(0|[1-9][0-9]*)$/u.test(raw)) {
    throw new StorageError("DOCUMENT_STORAGE_GATE_INVALID", `${name} must be a non-negative integer.`);
  }
  return checkedInteger(name, Number(raw), minimum, maximum);
}

function checkedInteger(name: string, value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new StorageError(
      "DOCUMENT_STORAGE_GATE_INVALID",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function configuredRatioPpm() {
  const raw = process.env.AIBRAIN_MINIMUM_FREE_RATIO?.trim();
  if (!raw) return DEFAULT_MINIMUM_FREE_RATIO_PPM;
  if (!/^(?:0(?:\.[0-9]{1,6})?|0?\.[0-9]{1,6})$/u.test(raw)) {
    throw new StorageError(
      "DOCUMENT_STORAGE_GATE_INVALID",
      "AIBRAIN_MINIMUM_FREE_RATIO must be between zero and 0.95 with at most six decimals.",
    );
  }
  const ratio = Number(raw);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 0.95) {
    throw new StorageError(
      "DOCUMENT_STORAGE_GATE_INVALID",
      "AIBRAIN_MINIMUM_FREE_RATIO must be between zero and 0.95.",
    );
  }
  return Math.ceil(ratio * PARTS_PER_MILLION);
}

function maximum(left: bigint, right: bigint) {
  return left > right ? left : right;
}

function ratioBytes(totalBytes: bigint, ratioPpm: number) {
  const numerator = totalBytes * BigInt(ratioPpm);
  return (numerator + BigInt(PARTS_PER_MILLION - 1)) / BigInt(PARTS_PER_MILLION);
}

export class DocumentStorageBackpressureError extends StorageError {
  readonly retryable = true;

  constructor(
    readonly retryAfterMs: number,
    readonly availableBytes: bigint,
    readonly requiredBytes: bigint,
  ) {
    super(
      "DOCUMENT_STORAGE_BACKPRESSURE",
      "Document storage does not have enough safety headroom for another active upload.",
    );
  }
}

/**
 * Installation-wide admission for the complete upload + preview lifecycle.
 *
 * Every active slot is conservatively budgeted at the configured worst case.
 * The capacity check reserves all possible simultaneous slots, so independent
 * processes cannot race the filesystem below the operational free-space floor.
 */
export class FileDocumentStorageGate {
  readonly rootDirectory: string;
  readonly capacityRoot: string;
  readonly maxActiveUploads: number;
  readonly minimumFreeBytes: number;
  readonly minimumFreeRatioPpm: number;
  readonly worstCaseActiveBytes: number;
  readonly retryAfterMs: number;
  private readonly locks: ResourceLockManager;
  private readonly readCapacity: () => Promise<FilesystemCapacity>;

  constructor(options: {
    rootDirectory: string;
    capacityRoot: string;
    maxActiveUploads?: number;
    minimumFreeBytes?: number;
    minimumFreeRatioPpm?: number;
    worstCaseActiveBytes?: number;
    retryAfterMs?: number;
    staleAfterMs?: number;
    heartbeatIntervalMs?: number;
    readCapacity?: () => Promise<FilesystemCapacity>;
  }) {
    if (
      !path.isAbsolute(options.rootDirectory)
      || options.rootDirectory === path.parse(options.rootDirectory).root
      || !path.isAbsolute(options.capacityRoot)
      || options.capacityRoot === path.parse(options.capacityRoot).root
    ) {
      throw new StorageError(
        "DOCUMENT_STORAGE_GATE_INVALID",
        "Storage gate roots must be non-root absolute paths.",
      );
    }
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.capacityRoot = path.resolve(options.capacityRoot);
    this.maxActiveUploads = checkedInteger(
      "maxActiveUploads",
      options.maxActiveUploads ?? configuredInteger(
        "AIBRAIN_DOCUMENT_MAX_ACTIVE_UPLOADS",
        DEFAULT_MAX_ACTIVE_UPLOADS,
        1,
        64,
      ),
      1,
      64,
    );
    this.minimumFreeBytes = checkedInteger(
      "minimumFreeBytes",
      options.minimumFreeBytes ?? configuredInteger(
        "AIBRAIN_MINIMUM_FREE_BYTES",
        DEFAULT_MINIMUM_FREE_BYTES,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      0,
      Number.MAX_SAFE_INTEGER,
    );
    this.minimumFreeRatioPpm = checkedInteger(
      "minimumFreeRatioPpm",
      options.minimumFreeRatioPpm ?? configuredRatioPpm(),
      0,
      950_000,
    );
    this.worstCaseActiveBytes = checkedInteger(
      "worstCaseActiveBytes",
      options.worstCaseActiveBytes ?? configuredInteger(
        "AIBRAIN_DOCUMENT_WORST_CASE_ACTIVE_BYTES",
        DEFAULT_WORST_CASE_ACTIVE_BYTES,
        128 * MEBIBYTE,
        4 * 1024 * MEBIBYTE,
      ),
      128 * MEBIBYTE,
      4 * 1024 * MEBIBYTE,
    );
    this.retryAfterMs = checkedInteger(
      "retryAfterMs",
      options.retryAfterMs ?? configuredInteger(
        "AIBRAIN_DOCUMENT_STORAGE_RETRY_AFTER_MS",
        DEFAULT_RETRY_AFTER_MS,
        1,
        60_000,
      ),
      1,
      60_000,
    );
    this.locks = new ResourceLockManager({
      rootDirectory: this.rootDirectory,
      staleAfterMs: options.staleAfterMs ?? 30_000,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      defaultTimeoutMs: 0,
    });
    this.readCapacity = options.readCapacity ?? (async () => statfs(this.capacityRoot, { bigint: true }));
  }

  private async acquire(signal?: AbortSignal): Promise<ResourceLockLease> {
    for (let slot = 0; slot < this.maxActiveUploads; slot += 1) {
      try {
        return await this.locks.acquire(`document-storage-slot:${slot}`, { timeoutMs: 0, signal });
      } catch (error) {
        if (!(error instanceof ResourceLockTimeoutError)) throw error;
      }
    }
    throw new DocumentStorageBackpressureError(this.retryAfterMs, 0n, 0n);
  }

  private async assertCapacity() {
    let capacity: FilesystemCapacity;
    try {
      capacity = await this.readCapacity();
    } catch (error) {
      throw new StorageError(
        "DOCUMENT_STORAGE_CAPACITY_UNAVAILABLE",
        "Document storage capacity could not be measured safely.",
        { cause: error },
      );
    }
    if (capacity.bavail < 0n || capacity.bsize <= 0n || capacity.blocks <= 0n) {
      throw new StorageError(
        "DOCUMENT_STORAGE_CAPACITY_UNAVAILABLE",
        "Document storage capacity returned invalid filesystem values.",
      );
    }
    const availableBytes = capacity.bavail * capacity.bsize;
    const totalBytes = capacity.blocks * capacity.bsize;
    const operationalFloor = maximum(
      BigInt(this.minimumFreeBytes),
      ratioBytes(totalBytes, this.minimumFreeRatioPpm),
    );
    const activeReservation = BigInt(this.maxActiveUploads) * BigInt(this.worstCaseActiveBytes);
    const requiredBytes = operationalFloor + activeReservation;
    if (availableBytes < requiredBytes) {
      throw new DocumentStorageBackpressureError(
        this.retryAfterMs,
        availableBytes,
        requiredBytes,
      );
    }
  }

  async run<T>(operation: () => T | Promise<T>, options: { signal?: AbortSignal } = {}) {
    const lease = await this.acquire(options.signal);
    try {
      await this.assertCapacity();
      return await operation();
    } finally {
      await lease.release();
    }
  }
}
