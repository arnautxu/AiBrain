import { INSTANTLY_OPERATIONS, type InstantlyOperation } from "@/connectors/instantly-contracts";

export class InstantlyError extends Error {
  constructor(readonly code: string) { super(code); this.name = "InstantlyError"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function instantlyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function pick(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(k => value[k] !== undefined &&
    (value[k] === null || ["string", "number", "boolean"].includes(typeof value[k])))
    .map(k => [k, typeof value[k] === "string" ? value[k].slice(0, 8_000) : value[k]]));
}
const FIELDS = {
  accounts: ["email", "first_name", "last_name", "organization", "status", "warmup_status", "stat_warmup_score", "provider_code", "setup_pending", "timestamp_warmup_start", "daily_limit", "sending_gap"],
  campaigns: ["id", "name", "organization", "status", "timestamp_created", "timestamp_updated"],
  leads: ["id", "organization", "campaign", "status", "email", "first_name", "last_name", "company_name", "job_title", "website", "verification_status", "lt_interest_status", "email_reply_count", "timestamp_last_reply"],
  replies: ["id", "organization_id", "campaign_id", "lead_id", "subject", "from_address_email", "content_preview", "timestamp_email", "eaccount", "ue_type", "is_auto_reply", "i_status", "thread_id"],
};

/** Only fixed, documented read endpoints. No arbitrary URL, headers or method. */
export async function instantlyRead(
  fetcher: typeof fetch, key: string, workspaceId: string, operation: InstantlyOperation,
  args: Record<string, unknown> = {},
) {
  if (!UUID.test(workspaceId) || !INSTANTLY_OPERATIONS.includes(operation) ||
      !instantlyRecord(args) || Object.keys(args).some(k => !["limit", "cursor", "campaignId", "emails", "startDate", "endDate"].includes(k))) throw new InstantlyError("INSTANTLY_ARGUMENTS_INVALID");
  const allowed = operation === "warmup" ? ["emails"] : operation === "metrics" ? ["campaignId", "startDate", "endDate"] : operation === "leads" || operation === "replies" ? ["limit", "cursor", "campaignId"] : operation === "accounts" || operation === "campaigns" ? ["limit", "cursor"] : [];
  if (Object.keys(args).some(k => !allowed.includes(k)) ||
      args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100) ||
      args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length < 1 || args.cursor.length > 250 || /[\r\n]/.test(args.cursor)) ||
      args.campaignId !== undefined && (typeof args.campaignId !== "string" || !UUID.test(args.campaignId)) ||
      [args.startDate, args.endDate].some(v => v !== undefined && (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)))) throw new InstantlyError("INSTANTLY_ARGUMENTS_INVALID");
  async function request(endpoint: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`https://api.instantly.ai/api/v2/${endpoint}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 AiBrain-ReadOnly/1.0" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new InstantlyError("INSTANTLY_PROVIDER_UNAVAILABLE"); }
    if (!response.ok) throw new InstantlyError(`INSTANTLY_HTTP_${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new InstantlyError("INSTANTLY_RESPONSE_TOO_LARGE");
    try { return JSON.parse(text) as unknown; } catch { throw new InstantlyError("INSTANTLY_RESPONSE_INVALID"); }
  }
  const workspace = await request("workspaces/current");
  if (!instantlyRecord(workspace) || workspace.id !== workspaceId) throw new InstantlyError("INSTANTLY_WORKSPACE_MISMATCH");
  const base = { workspaceId, checkedAt: new Date().toISOString(), source: "Instantly API v2", readOnly: true };
  if (operation === "workspace") return { ...base, workspace: pick(workspace, ["id", "name"]) };
  const query = new URLSearchParams();
  if (["accounts", "campaigns", "replies"].includes(operation)) {
    query.set("limit", String(args.limit ?? 50));
    if (args.cursor) query.set("starting_after", String(args.cursor));
  }
  if (operation === "replies") { query.set("email_type", "received"); if (args.campaignId) query.set("campaign_id", String(args.campaignId)); }
  if (operation === "metrics") {
    if (args.campaignId) query.set("id", String(args.campaignId));
    if (args.startDate) query.set("start_date", String(args.startDate));
    if (args.endDate) query.set("end_date", String(args.endDate));
  }
  if (operation === "warmup") {
    if (!Array.isArray(args.emails) || args.emails.length < 1 || args.emails.length > 100 ||
        !args.emails.every(e => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254)) throw new InstantlyError("INSTANTLY_ARGUMENTS_INVALID");
    // Ownership is checked even if a provider later accepts foreign emails.
    const owned = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const accounts = await request(`accounts?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`);
      if (!instantlyRecord(accounts) || !Array.isArray(accounts.items)) throw new InstantlyError("INSTANTLY_RESPONSE_INVALID");
      for (const a of accounts.items) {
        if (!instantlyRecord(a) || a.organization !== workspaceId) throw new InstantlyError("INSTANTLY_WORKSPACE_MISMATCH");
        if (typeof a.email === "string") owned.add(a.email);
      }
      const next = typeof accounts.next_starting_after === "string" ? accounts.next_starting_after : undefined;
      if (!next || next === cursor || accounts.items.length === 0) break;
      cursor = next;
    }
    if (!args.emails.every(e => owned.has(e))) throw new InstantlyError("INSTANTLY_ACCOUNT_DENIED");
    const raw = await request("accounts/warmup-analytics", { emails: args.emails });
    // This endpoint is numeric analytics; preserve numeric-only nested data.
    const numeric = (v: unknown, depth = 0): unknown => depth > 8 ? null : typeof v === "number" || typeof v === "boolean" || v === null ? v : Array.isArray(v) ? v.slice(0, 100).map(x => numeric(x, depth + 1)) : instantlyRecord(v) ? Object.fromEntries(Object.entries(v).slice(0, 200).filter(([k]) => !/password|secret|token|cookie|key|auth/i.test(k)).map(([k, x]) => [k, numeric(x, depth + 1)])) : null;
    return { ...base, analytics: numeric(raw) };
  }
  const endpoints = { accounts: "accounts", campaigns: "campaigns", leads: "leads/list", replies: "emails", metrics: "campaigns/analytics/overview" };
  const body = operation === "leads" ? { limit: args.limit ?? 50, ...(args.cursor ? { starting_after: args.cursor } : {}), ...(args.campaignId ? { campaign: args.campaignId } : {}) } : undefined;
  const raw = await request(`${endpoints[operation]}${query.size ? `?${query}` : ""}`, body);
  if (!instantlyRecord(raw)) throw new InstantlyError("INSTANTLY_RESPONSE_INVALID");
  if (operation === "metrics") return { ...base, metrics: Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^[a-z_]+$/.test(k) && typeof v === "number" && Number.isFinite(v))) };
  if (!Array.isArray(raw.items)) throw new InstantlyError("INSTANTLY_RESPONSE_INVALID");
  const items = raw.items.map(item => {
    if (!instantlyRecord(item) || item[operation === "replies" ? "organization_id" : "organization"] !== workspaceId) throw new InstantlyError("INSTANTLY_WORKSPACE_MISMATCH");
    const safe = pick(item, FIELDS[operation]);
    if (operation === "replies" && instantlyRecord(item.body) && typeof item.body.text === "string") safe.bodyText = item.body.text.slice(0, 8_000);
    return safe;
  });
  return { ...base, items, nextCursor: typeof raw.next_starting_after === "string" ? raw.next_starting_after.slice(0, 250) : null, untrustedContent: true };
}
