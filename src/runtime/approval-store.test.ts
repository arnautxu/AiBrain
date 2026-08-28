import { chmod, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isApprovalItem, isApprovalResolutionRequest, type ApprovalItem } from "@/lib/chat-contract";
import {
  FileApprovalStore,
  approvalLocatorFromItem,
  waitForApproval,
  type ConnectorApprovalReceipt,
  type ApprovalLocator,
} from "@/runtime/approval-store";

const INSTALLATION_ID = "northwind-test";
const USER_A = "11a11111-1111-4111-8111-111111111111";
const USER_B = "22b22222-2222-4222-8222-222222222222";

function approval(
  approvalId: string,
  threadId: string,
  turnId: string,
  itemId: string,
): ApprovalItem {
  return {
    id: approvalId,
    threadId,
    turnId,
    itemId,
    kind: "command",
    title: "Approve command",
    detail: "Synthetic approval used only by tests.",
    status: "pending",
  };
}

describe("FileApprovalStore", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })));
  });

  async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), "aibrain-approvals-"));
    temporaryRoots.push(root);
    const usersRoot = path.join(root, "employees");
    await mkdir(path.join(usersRoot, USER_A), { recursive: true, mode: 0o700 });
    await mkdir(path.join(usersRoot, USER_B), { recursive: true, mode: 0o700 });
    await chmod(usersRoot, 0o700);
    await chmod(path.join(usersRoot, USER_A), 0o700);
    await chmod(path.join(usersRoot, USER_B), 0o700);
    return { root, usersRoot };
  }

  function store(usersRoot: string, userId = USER_A, now?: () => number) {
    return new FileApprovalStore({
      installationId: INSTALLATION_ID,
      userId,
      usersRoot,
      ...(now ? { now } : {}),
    });
  }

  function locator(item: ApprovalItem, userId = USER_A): ApprovalLocator {
    return approvalLocatorFromItem(INSTALLATION_ID, userId, item);
  }

  function fingerprint(seed = "a") {
    return seed.repeat(64);
  }

  function receiptFrom(result: { receipt: ConnectorApprovalReceipt | null }) {
    if (!result.receipt) throw new Error("Expected connector approval receipt.");
    return result.receipt;
  }

  it("persists a decision across independent store instances and restart replay", async () => {
    const { usersRoot } = await fixture();
    const item = approval("approval-restart", "thread-restart", "turn-restart", "item-restart");
    const firstProcess = store(usersRoot);
    await firstProcess.createPending({ locator: locator(item), requestType: "command" });

    const secondProcess = store(usersRoot);
    expect((await secondProcess.resolve(locator(item), "accept")).outcome).toBe("resolved");

    const restartedProcess = store(usersRoot);
    await expect(waitForApproval(
      restartedProcess,
      item,
      "command",
      new AbortController().signal,
      { pollIntervalMs: 5 },
    )).resolves.toBe("accept");
    expect(await restartedProcess.read(locator(item))).toMatchObject({
      status: "resolved",
      decision: "accept",
    });
    expect((await restartedProcess.readEvents()).map((entry) => entry.payload.eventType))
      .toEqual(["requested", "resolved"]);
  });

  it("repairs a missing journal tail from the authoritative record after a crash", async () => {
    const { usersRoot } = await fixture();
    const item = approval("approval-repair", "thread-repair", "turn-repair", "item-repair");
    const firstProcess = store(usersRoot);
    await firstProcess.createPending({ locator: locator(item), requestType: "permissions" });
    await firstProcess.resolve(locator(item), "acceptForSession");
    await rm(firstProcess.journalPath);

    const restartedProcess = store(usersRoot);
    await expect(waitForApproval(
      restartedProcess,
      item,
      "permissions",
      new AbortController().signal,
      { pollIntervalMs: 5 },
    )).resolves.toBe("acceptForSession");
    expect((await restartedProcess.readEvents()).map((entry) => ({
      eventType: entry.payload.eventType,
      decision: entry.payload.decision,
    }))).toEqual([
      { eventType: "requested", decision: null },
      { eventType: "resolved", decision: "acceptForSession" },
    ]);
  });

  it("rejects cross-user identity and cannot resolve a different thread, turn, or item", async () => {
    const { usersRoot } = await fixture();
    const item = approval("approval-isolated", "thread-a", "turn-a", "item-a");
    const userAStore = store(usersRoot, USER_A);
    await userAStore.createPending({ locator: locator(item, USER_A), requestType: "command" });

    const wrongThread = { ...locator(item, USER_A), threadId: "thread-b" };
    const wrongTurn = { ...locator(item, USER_A), turnId: "turn-b" };
    const wrongItem = { ...locator(item, USER_A), itemId: "item-b" };
    await expect(userAStore.resolve(wrongThread, "accept")).resolves.toMatchObject({
      outcome: "not-found",
    });
    await expect(userAStore.resolve(wrongTurn, "accept")).resolves.toMatchObject({
      outcome: "not-found",
    });
    await expect(userAStore.resolve(wrongItem, "accept")).resolves.toMatchObject({
      outcome: "not-found",
    });

    const userBStore = store(usersRoot, USER_B);
    await expect(userBStore.resolve(locator(item, USER_A), "accept"))
      .rejects.toMatchObject({ code: "APPROVAL_IDENTITY_MISMATCH" });
    expect(await userAStore.read(locator(item, USER_A))).toMatchObject({ status: "pending" });
  });

  it("lets an unrelated approval resolve while another turn remains pending", async () => {
    const { usersRoot } = await fixture();
    const approvals = store(usersRoot);
    const first = approval("approval-first", "thread-first", "turn-first", "item-first");
    const second = approval("approval-second", "thread-second", "turn-second", "item-second");
    await approvals.createPending({ locator: locator(first), requestType: "command" });
    await approvals.createPending({ locator: locator(second), requestType: "command" });

    const firstWait = waitForApproval(
      approvals,
      first,
      "command",
      new AbortController().signal,
      { pollIntervalMs: 5 },
    );
    const secondWait = waitForApproval(
      approvals,
      second,
      "command",
      new AbortController().signal,
      { pollIntervalMs: 5 },
    );
    await approvals.resolve(locator(second), "decline");
    await expect(secondWait).resolves.toBe("decline");
    expect(await approvals.read(locator(first))).toMatchObject({ status: "pending" });
    await approvals.resolve(locator(first), "acceptForSession");
    await expect(firstWait).resolves.toBe("acceptForSession");
  });

  it("is exactly idempotent for the same decision and rejects conflicting replay", async () => {
    const { usersRoot } = await fixture();
    const approvals = store(usersRoot);
    const item = approval("approval-idempotent", "thread-idempotent", "turn-idempotent", "item-idempotent");
    await approvals.createPending({ locator: locator(item), requestType: "file" });
    expect((await approvals.resolve(locator(item), "accept")).outcome).toBe("resolved");
    expect((await approvals.resolve(locator(item), "accept")).outcome).toBe("already-resolved");
    await expect(approvals.resolve(locator(item), "decline"))
      .rejects.toMatchObject({ code: "APPROVAL_DECISION_CONFLICT" });
    expect((await approvals.readEvents()).map((entry) => entry.payload.eventType))
      .toEqual(["requested", "resolved"]);
  });

  it("expires pending state durably and cancels a waiting approval on abort", async () => {
    const { usersRoot } = await fixture();
    let clock = Date.UTC(2026, 7, 27, 12, 0, 0);
    const approvals = store(usersRoot, USER_A, () => clock);
    const expiring = approval("approval-expiring", "thread-expiring", "turn-expiring", "item-expiring");
    await approvals.createPending({
      locator: locator(expiring),
      requestType: "command",
      ttlMs: 100,
    });
    clock += 101;
    expect(await approvals.read(locator(expiring))).toMatchObject({ status: "expired" });

    const cancellable = approval("approval-cancel", "thread-cancel", "turn-cancel", "item-cancel");
    const controller = new AbortController();
    const waiting = waitForApproval(approvals, cancellable, "command", controller.signal, {
      pollIntervalMs: 5,
      ttlMs: 1_000,
    });
    controller.abort();
    await expect(waiting).resolves.toBe("cancel");
    expect(await approvals.read(locator(cancellable))).toMatchObject({ status: "cancelled" });
  });

  it("rejects a symlink substituted for a durable approval record", async () => {
    const { root, usersRoot } = await fixture();
    const approvals = store(usersRoot);
    const item = approval("approval-link", "thread-link", "turn-link", "item-link");
    await approvals.createPending({ locator: locator(item), requestType: "command" });
    const files = await readdir(approvals.recordsRoot);
    const target = path.join(approvals.recordsRoot, files[0]);
    await rm(target);
    await symlink(path.join(root, "outside.json"), target);
    await expect(approvals.read(locator(item)))
      .rejects.toMatchObject({ code: "APPROVAL_PATH_UNSAFE" });
  });

  it("requires the complete routing tuple in the browser decision contract", () => {
    expect(isApprovalItem({
      ...approval("approval-browser", "thread-browser", "turn-browser", "item-browser"),
      kind: "browser",
      permissionFingerprint: "a".repeat(64),
    })).toBe(true);
    expect(isApprovalResolutionRequest({
      approvalId: "approval-contract",
      threadId: "thread-contract",
      turnId: "turn-contract",
      itemId: "item-contract",
      decision: "accept",
    })).toBe(true);
    expect(isApprovalResolutionRequest({
      approvalId: "approval-contract",
      decision: "accept",
    })).toBe(false);
    expect(isApprovalResolutionRequest({
      approvalId: "approval-contract",
      threadId: "thread-other",
      turnId: "turn-contract",
      itemId: "item-contract",
      decision: "always",
    })).toBe(false);
  });

  it("binds connector authorization, receipt, revalidation, execution, and audit without arguments", async () => {
    const { usersRoot } = await fixture();
    const approvals = store(usersRoot);
    const item = approval("connector-success", "thread-connector", "turn-connector", "item-connector");
    const prepared = await approvals.prepareConnectorApproval({
      locator: locator(item),
      authorizationFingerprint: fingerprint(),
    });
    const receipt = receiptFrom(prepared);
    expect(prepared.record.status).toBe("approval_requested");
    expect((await approvals.approveConnectorApproval(receipt)).outcome).toBe("approved");

    let executions = 0;
    const first = await approvals.executeConnectorApproval(receipt, {
      revalidate: () => true,
      execute: () => {
        executions += 1;
        return "connector mutation completed";
      },
    });
    expect(first).toMatchObject({ outcome: "executed", value: "connector mutation completed" });
    expect((await approvals.executeConnectorApproval(receipt, {
      revalidate: () => true,
      execute: () => {
        executions += 1;
      },
    })).outcome).toBe("replayed");
    expect(executions).toBe(1);

    const events = await approvals.readConnectorApprovalEvents();
    expect(events.map((entry) => entry.payload.eventType))
      .toEqual(["authorized", "approval_requested", "approved", "executed"]);
    expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual([
      "approvalId",
      "authorizationFingerprint",
      "eventType",
      "installationId",
      "itemId",
      "occurredAt",
      "schemaVersion",
      "threadId",
      "turnId",
      "userId",
    ]);
  });

  it("denies tampered, cross-user, expired, and failed connector approvals", async () => {
    const { usersRoot } = await fixture();
    const approvals = store(usersRoot);
    const item = approval("connector-tamper", "thread-tamper", "turn-tamper", "item-tamper");
    const receipt = receiptFrom(await approvals.prepareConnectorApproval({
      locator: locator(item),
      authorizationFingerprint: fingerprint("a"),
    }));
    const tampered = { ...receipt, authorizationFingerprint: fingerprint("b") };
    expect((await approvals.approveConnectorApproval(tampered)).outcome).toBe("denied");
    expect(await approvals.readConnectorApproval(locator(item))).toMatchObject({ status: "denied" });

    const locatorFingerprintItem = approval("connector-locator-fingerprint", "thread-locator", "turn-locator", "item-locator");
    await approvals.prepareConnectorApproval({
      locator: locator(locatorFingerprintItem),
      authorizationFingerprint: fingerprint("f"),
    });
    expect((await approvals.approveConnectorApprovalByLocator(
      locator(locatorFingerprintItem),
      fingerprint("0"),
    )).outcome).toBe("fingerprint-mismatch");
    expect(await approvals.readConnectorApproval(locator(locatorFingerprintItem)))
      .toMatchObject({ status: "approval_requested" });

    const deniedItem = approval("connector-denied", "thread-denied", "turn-denied", "item-denied");
    await approvals.prepareConnectorApproval({
      locator: locator(deniedItem),
      authorizationFingerprint: fingerprint("9"),
    });
    expect((await approvals.denyConnectorApprovalByLocator(
      locator(deniedItem),
      fingerprint("9"),
    )).outcome).toBe("denied");
    expect((await approvals.denyConnectorApprovalByLocator(
      locator(deniedItem),
      fingerprint("9"),
    )).outcome).toBe("already-denied");
    expect((await approvals.approveConnectorApprovalByLocator(
      locator(deniedItem),
      fingerprint("9"),
    )).outcome).toBe("not-pending");
    expect(await store(usersRoot).readConnectorApproval(locator(deniedItem)))
      .toMatchObject({ status: "denied" });

    const crossUserItem = approval("connector-cross-user", "thread-cross", "turn-cross", "item-cross");
    const crossUserReceipt = receiptFrom(await approvals.prepareConnectorApproval({
      locator: locator(crossUserItem),
      authorizationFingerprint: fingerprint("c"),
    }));
    await expect(store(usersRoot, USER_B).approveConnectorApproval(crossUserReceipt))
      .rejects.toMatchObject({ code: "APPROVAL_IDENTITY_MISMATCH" });
    expect(await approvals.readConnectorApproval(locator(crossUserItem))).toMatchObject({ status: "approval_requested" });

    let clock = Date.UTC(2026, 7, 28, 12, 0, 0);
    const expiring = store(usersRoot, USER_A, () => clock);
    const expiredItem = approval("connector-expired", "thread-expired", "turn-expired", "item-expired");
    const expiredReceipt = receiptFrom(await expiring.prepareConnectorApproval({
      locator: locator(expiredItem),
      authorizationFingerprint: fingerprint("d"),
      ttlMs: 10,
    }));
    clock += 11;
    expect((await expiring.approveConnectorApproval(expiredReceipt)).outcome).toBe("not-pending");
    expect(await expiring.readConnectorApproval(locator(expiredItem))).toMatchObject({ status: "denied" });

    const staleItem = approval("connector-stale", "thread-stale", "turn-stale", "item-stale");
    const staleReceipt = receiptFrom(await approvals.prepareConnectorApproval({
      locator: locator(staleItem),
      authorizationFingerprint: fingerprint("f"),
    }));
    await approvals.approveConnectorApproval(staleReceipt);
    let staleExecuted = false;
    expect((await approvals.executeConnectorApproval(staleReceipt, {
      revalidate: () => false,
      execute: () => { staleExecuted = true; },
    })).outcome).toBe("denied");
    expect(staleExecuted).toBe(false);
    expect(await approvals.readConnectorApproval(locator(staleItem))).toMatchObject({ status: "denied" });

    const failureItem = approval("connector-failed", "thread-failed", "turn-failed", "item-failed");
    const failureReceipt = receiptFrom(await approvals.prepareConnectorApproval({
      locator: locator(failureItem),
      authorizationFingerprint: fingerprint("e"),
    }));
    await approvals.approveConnectorApproval(failureReceipt);
    await expect(approvals.executeConnectorApproval(failureReceipt, {
      revalidate: () => true,
      execute: () => { throw new Error("adapter unavailable"); },
    })).rejects.toMatchObject({ code: "CONNECTOR_APPROVAL_EXECUTION_FAILED" });
    expect(await approvals.readConnectorApproval(locator(failureItem))).toMatchObject({ status: "failed" });
  });
});
