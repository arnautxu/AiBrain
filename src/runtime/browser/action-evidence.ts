import { createHash } from "node:crypto";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export type BrowserMutationAction = "open" | "scroll" | "click" | "type";

export type BrowserInteractionCommand = Readonly<{
  action: BrowserMutationAction;
  selector?: string;
}>;

export type BrowserActionResourceSnapshot = Readonly<{
  kind: "browser-page";
  origin: string;
  sanitizedUrl: string;
  scopeId: string;
  generation: number;
  version: string;
  locatorHash: string;
  locatorSummary: string;
}>;

export type BrowserInformedApprovalEvidence = Readonly<{
  schemaVersion: 1;
  installationId: string;
  userId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  callId: string;
  actionKind: BrowserMutationAction;
  permissionFingerprint: string;
  resource: Readonly<{
    kind: "browser-page";
    origin: string;
    scopeId: string;
    generation: number;
    version: string;
    locatorHash: string;
  }>;
  request: Readonly<{
    operation: BrowserMutationAction;
    argsHash: string;
    summary: string;
    secretInput: boolean;
  }>;
  preparedAt: string;
  expiresAt: string;
  evidenceFingerprint: string;
}>;

export type BrowserActionReadback = Readonly<{
  schemaVersion: 1;
  outcome: "applied" | "dispatched";
  verification: "type-value-matched" | "cdp-dispatch-acknowledged";
  actionKind: BrowserMutationAction;
  evidenceFingerprint: string;
  resource: BrowserActionResourceSnapshot;
  observedAt: string;
}>;

const SENSITIVE_CLICK_PATTERN = /\b(?:send|submit|publish|post|buy|purchase|checkout|pay|order|delete|remove|save|update|change|confirm|subscribe|unsubscribe|follow|connect|like|share|sign\s*in|log\s*in|log\s*out|enviar|envia|publicar|comprar|compra|pagar|paga|pedido|comanda|borrar|esborrar|eliminar|guardar|desar|actualizar|actualitzar|cambiar|canviar|confirmar|suscribir|subscriure|seguir|conectar|connectar|iniciar\s+sesion|cerrar\s+sesion)\b/u;
const SENSITIVE_TYPE_PATTERN = /\b(?:password|passcode|one\s*time\s*password|otp|secret|token|pin|credit\s*card|card\s*number|cvv|cvc|iban|bank\s*account|contrasena|contrasenya|clave|tarjeta|targeta|cuenta\s+bancaria|compte\s+bancari)\b/u;

function normalizedInteractionText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
}

/**
 * Approval is about the external effect, not about operating the browser.
 * This classification consumes only the server-prepared target snapshot, so
 * untrusted page instructions cannot opt themselves out of approval.
 */
export function browserInteractionRequiresApproval(
  command: BrowserInteractionCommand,
  resource: BrowserActionResourceSnapshot,
) {
  if (command.action === "open" || command.action === "scroll") return false;
  const target = normalizedInteractionText(`${command.selector ?? ""} ${resource.locatorSummary}`);
  if (command.action === "type") return SENSITIVE_TYPE_PATTERN.test(target);
  return SENSITIVE_CLICK_PATTERN.test(target) || /\btype\s*=\s*["']?submit\b/u.test(target);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Browser evidence contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Browser evidence is not canonical JSON.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function browserEvidenceHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function buildBrowserApprovalEvidence(input: {
  installationId: string;
  userId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  callId: string;
  actionKind: BrowserMutationAction;
  permissionFingerprint: string;
  argsHash: string;
  summary: string;
  secretInput: boolean;
  resource: BrowserActionResourceSnapshot;
  now?: number;
  ttlMs?: number;
}): BrowserInformedApprovalEvidence {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 5 * 60_000) {
    throw new Error("Browser evidence lifetime is invalid.");
  }
  const unsigned = {
    schemaVersion: 1 as const,
    installationId: input.installationId,
    userId: input.userId,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: input.itemId,
    callId: input.callId,
    actionKind: input.actionKind,
    permissionFingerprint: input.permissionFingerprint,
    resource: {
      kind: input.resource.kind,
      origin: input.resource.origin,
      scopeId: input.resource.scopeId,
      generation: input.resource.generation,
      version: input.resource.version,
      locatorHash: input.resource.locatorHash,
    },
    request: {
      operation: input.actionKind,
      argsHash: input.argsHash,
      summary: input.summary,
      secretInput: input.secretInput,
    },
    preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  return Object.freeze({
    ...unsigned,
    resource: Object.freeze(unsigned.resource),
    request: Object.freeze(unsigned.request),
    evidenceFingerprint: browserEvidenceHash(unsigned),
  });
}

export function assertBrowserApprovalEvidence(
  value: unknown,
): BrowserInformedApprovalEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser approval evidence is invalid.");
  }
  const evidence = value as BrowserInformedApprovalEvidence;
  if (evidence.schemaVersion !== 1 ||
    typeof evidence.installationId !== "string" || typeof evidence.userId !== "string" ||
    typeof evidence.threadId !== "string" || typeof evidence.turnId !== "string" ||
    typeof evidence.itemId !== "string" || typeof evidence.callId !== "string" ||
    !["open", "scroll", "click", "type"].includes(evidence.actionKind) ||
    typeof evidence.permissionFingerprint !== "string" ||
    !evidence.resource || typeof evidence.resource !== "object" ||
    evidence.resource.kind !== "browser-page" || typeof evidence.resource.origin !== "string" ||
    typeof evidence.resource.scopeId !== "string" || !Number.isSafeInteger(evidence.resource.generation) ||
    typeof evidence.resource.version !== "string" || typeof evidence.resource.locatorHash !== "string" ||
    !evidence.request || typeof evidence.request !== "object" ||
    evidence.request.operation !== evidence.actionKind || typeof evidence.request.argsHash !== "string" ||
    typeof evidence.request.summary !== "string" || typeof evidence.request.secretInput !== "boolean" ||
    typeof evidence.preparedAt !== "string" || typeof evidence.expiresAt !== "string" ||
    typeof evidence.evidenceFingerprint !== "string") {
    throw new Error("Browser approval evidence is invalid.");
  }
  const valueKeys = Object.keys(evidence).sort();
  const expectedKeys = ["schemaVersion", "installationId", "userId", "threadId", "turnId", "itemId", "callId",
    "actionKind", "permissionFingerprint", "resource", "request", "preparedAt", "expiresAt", "evidenceFingerprint"].sort();
  const resourceKeys = Object.keys(evidence.resource).sort();
  const requestKeys = Object.keys(evidence.request).sort();
  if (valueKeys.join("\0") !== expectedKeys.join("\0") ||
    resourceKeys.join("\0") !== ["kind", "origin", "scopeId", "generation", "version", "locatorHash"].sort().join("\0") ||
    requestKeys.join("\0") !== ["operation", "argsHash", "summary", "secretInput"].sort().join("\0")) {
    throw new Error("Browser approval evidence is invalid.");
  }
  const { evidenceFingerprint, ...unsigned } = evidence;
  if (!SHA256_PATTERN.test(evidenceFingerprint) || browserEvidenceHash(unsigned) !== evidenceFingerprint) {
    throw new Error("Browser approval evidence fingerprint is invalid.");
  }
  const preparedAt = Date.parse(evidence.preparedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  if (!evidence.installationId || !evidence.userId || !evidence.threadId || !evidence.turnId ||
    !evidence.itemId || !evidence.callId || evidence.resource.scopeId.length < 1 ||
    evidence.resource.generation < 1 || evidence.resource.origin.length > 1_200 ||
    evidence.request.summary.length < 1 || evidence.request.summary.length > 2_000 ||
    !SHA256_PATTERN.test(evidence.resource.version) ||
    !SHA256_PATTERN.test(evidence.resource.locatorHash) || !SHA256_PATTERN.test(evidence.request.argsHash) ||
    !SHA256_PATTERN.test(evidence.permissionFingerprint) || !Number.isFinite(preparedAt) ||
    !Number.isFinite(expiresAt) || expiresAt <= preparedAt || expiresAt - preparedAt > 5 * 60_000) {
    throw new Error("Browser approval evidence is invalid.");
  }
  return evidence;
}

export function sameBrowserActionResource(
  left: BrowserActionResourceSnapshot,
  right: BrowserActionResourceSnapshot,
) {
  return left.kind === right.kind && left.origin === right.origin &&
    left.sanitizedUrl === right.sanitizedUrl && left.scopeId === right.scopeId &&
    left.generation === right.generation && left.version === right.version &&
    left.locatorHash === right.locatorHash;
}
