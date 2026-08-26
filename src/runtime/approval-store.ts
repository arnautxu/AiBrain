import type { ApprovalDecision, ApprovalItem } from "@/lib/chat-contract";

type PendingApproval = {
  tenantId: string;
  settle: (decision: ApprovalDecision | "cancel") => void;
};

declare global {
  var __aibrainApprovalStore: Map<string, PendingApproval> | undefined;
}

const approvals =
  globalThis.__aibrainApprovalStore ?? new Map<string, PendingApproval>();

globalThis.__aibrainApprovalStore = approvals;

export function waitForApproval(
  tenantId: string,
  approval: ApprovalItem,
  signal: AbortSignal,
): Promise<ApprovalDecision | "cancel"> {
  return new Promise((resolve) => {
    let settled = false;

    const settle = (decision: ApprovalDecision | "cancel") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      approvals.delete(approval.id);
      resolve(decision);
    };
    const cancel = () => settle("cancel");
    const timeout = setTimeout(cancel, 300_000);

    approvals.set(approval.id, { tenantId, settle });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

export function resolveApproval(
  tenantId: string,
  approvalId: string,
  decision: ApprovalDecision,
) {
  const approval = approvals.get(approvalId);
  if (!approval || approval.tenantId !== tenantId) return false;

  approval.settle(decision);
  return true;
}
