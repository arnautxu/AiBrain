import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedPermissions } from "@/permissions";
import { ResourceLockManager } from "@/storage";
import { FileDocumentStagingStore } from "@/documents/staging-store";
import { validateUploadedDocument } from "@/documents/upload-validation";
import {
  resolveTurnDocumentAttachments,
  turnDocumentChatAttachments,
  turnDocumentCodexInputs,
} from "@/documents/turn-attachments";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_THREAD_ID = "11111111-1111-4111-8111-111111111112";
const UPLOAD_ID = "22222222-2222-4222-8222-222222222222";
const roots: string[] = [];

function permissions(effect: "allow" | "deny"): ResolvedPermissions {
  return {
    schemaVersion: 1,
    installationId: "documents-lab",
    userId: "33333333-3333-4333-8333-333333333333",
    roleId: null,
    projectId: null,
    turnId: "44444444-4444-4444-8444-444444444444",
    resolvedAt: "2026-08-27T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    sources: [],
    rules: [{
      ruleId: "documents.read",
      action: "consult",
      effect,
      instruction: "Synthetic document access.",
      sourceScope: "installation",
      sourcePolicyVersion: 1,
      precedence: 100,
    }],
    developerInstructions: "Synthetic permission fixture.",
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aibrain-turn-documents-"));
  roots.push(root);
  await chmod(root, 0o700);
  const stagingRoot = path.join(root, "staging");
  const locks = new ResourceLockManager({ rootDirectory: path.join(root, "locks") });
  const staging = new FileDocumentStagingStore(stagingRoot, locks);
  const data = Buffer.from("server-derived attachment\n", "utf8");
  const validated = validateUploadedDocument({ fileName: "notes.txt", declaredMimeType: "text/plain", data });
  const document = await staging.stage({ threadId: THREAD_ID, uploadId: UPLOAD_ID, validated, data });
  return { root, stagingRoot, staging, document };
}

describe("turn document attachment binding", () => {
  it("resolves a permissioned upload to a verified server path and typed Codex inputs", async () => {
    const { staging, stagingRoot, document } = await fixture();
    const resolved = await resolveTurnDocumentAttachments({
      staging,
      threadId: THREAD_ID,
      uploadIds: [UPLOAD_ID],
      permissions: permissions("allow"),
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].absolutePath).toBe(path.join(stagingRoot, document.relativePath));
    expect(turnDocumentChatAttachments(resolved)).toEqual([{
      id: UPLOAD_ID,
      name: "notes.txt",
      mimeType: "text/plain",
      size: document.size,
    }]);
    expect(turnDocumentCodexInputs(resolved)).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining(document.sha256) }),
      { type: "mention", name: "notes.txt", path: resolved[0].absolutePath },
    ]);
  });

  it("rejects denied, cross-thread and content-tampered attachments", async () => {
    const { staging, stagingRoot, document } = await fixture();
    await expect(resolveTurnDocumentAttachments({
      staging,
      threadId: THREAD_ID,
      uploadIds: [UPLOAD_ID],
      permissions: permissions("deny"),
    })).rejects.toMatchObject({ code: "TURN_DOCUMENT_PERMISSION_DENIED" });
    await expect(resolveTurnDocumentAttachments({
      staging,
      threadId: OTHER_THREAD_ID,
      uploadIds: [UPLOAD_ID],
      permissions: permissions("allow"),
    })).rejects.toBeDefined();
    await writeFile(path.join(stagingRoot, document.relativePath), "tampered\n", "utf8");
    await expect(resolveTurnDocumentAttachments({
      staging,
      threadId: THREAD_ID,
      uploadIds: [UPLOAD_ID],
      permissions: permissions("allow"),
    })).rejects.toMatchObject({ code: "STORAGE_STAGING_CONTENT_CORRUPT" });
  });
});
