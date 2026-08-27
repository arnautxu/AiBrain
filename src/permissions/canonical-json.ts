import { createHash } from "node:crypto";
import { PermissionResolutionError } from "@/permissions/errors";

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PermissionResolutionError(
        "PERMISSION_POLICY_INVALID",
        "Canonical permission data contains a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new PermissionResolutionError(
      "PERMISSION_POLICY_INVALID",
      `Canonical permission data contains unsupported ${typeof value}.`,
    );
  }
  if (ancestors.has(value)) {
    throw new PermissionResolutionError(
      "PERMISSION_POLICY_INVALID",
      "Canonical permission data is cyclic.",
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PermissionResolutionError(
        "PERMISSION_POLICY_INVALID",
        "Canonical permission data must contain only plain objects.",
      );
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalPermissionJson(value: unknown) {
  return canonicalJson(value, new Set());
}

export function permissionFingerprint(value: unknown) {
  return createHash("sha256").update(canonicalPermissionJson(value)).digest("hex");
}
