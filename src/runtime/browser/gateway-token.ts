import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  BrowserGatewayCapability,
  BrowserGatewayClaims,
} from "@/runtime/browser/types";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTALLATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CAPABILITIES = ["view", "control", "heartbeat", "takeover"] as const;

export class BrowserGatewayTokenError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BrowserGatewayTokenError";
  }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
  );
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && USER_ID_PATTERN.test(value);
}

function normalizeCapabilities(value: readonly BrowserGatewayCapability[]) {
  const unique = [...new Set(value)];
  if (unique.length === 0 || unique.some((item) => !CAPABILITIES.includes(item))) {
    throw new BrowserGatewayTokenError("BROWSER_GATEWAY_CAPABILITIES_INVALID", "Gateway capabilities are invalid.");
  }
  return unique.sort() as BrowserGatewayCapability[];
}

function authSessionHash(authSessionId: string) {
  if (authSessionId.length < 32 || authSessionId.length > 512 || /\p{C}/u.test(authSessionId)) {
    throw new BrowserGatewayTokenError("BROWSER_GATEWAY_SESSION_INVALID", "Local auth session is invalid.");
  }
  return createHash("sha256").update(authSessionId).digest("hex");
}

function parseClaims(value: unknown): BrowserGatewayClaims {
  const keys = [
    "version",
    "audience",
    "tokenId",
    "installationId",
    "userId",
    "threadId",
    "browserSessionId",
    "authSessionHash",
    "capabilities",
    "issuedAt",
    "expiresAt",
  ] as const;
  if (!exactRecord(value, keys)) {
    throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TOKEN_INVALID", "Gateway token payload is invalid.");
  }
  if (
    value.version !== 2 ||
    value.audience !== "aibrain-browser-gateway" ||
    !isCanonicalUuid(value.tokenId) ||
    typeof value.installationId !== "string" ||
    !INSTALLATION_ID_PATTERN.test(value.installationId) ||
    !isCanonicalUuid(value.userId) ||
    !isCanonicalUuid(value.threadId) ||
    !isCanonicalUuid(value.browserSessionId) ||
    typeof value.authSessionHash !== "string" ||
    !HASH_PATTERN.test(value.authSessionHash) ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every((item): item is BrowserGatewayCapability =>
      typeof item === "string" && CAPABILITIES.includes(item as BrowserGatewayCapability)) ||
    new Set(value.capabilities).size !== value.capabilities.length ||
    !Number.isSafeInteger(value.issuedAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= (value.issuedAt as number)
  ) {
    throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TOKEN_INVALID", "Gateway token payload is invalid.");
  }
  return value as BrowserGatewayClaims;
}

export type IssueBrowserGatewayTokenInput = {
  installationId: string;
  userId: string;
  threadId: string;
  browserSessionId: string;
  authSessionId: string;
  capabilities: readonly BrowserGatewayCapability[];
  ttlMs?: number;
};

export type VerifyBrowserGatewayTokenInput = Omit<IssueBrowserGatewayTokenInput, "capabilities" | "ttlMs"> & {
  requiredCapability: BrowserGatewayCapability;
};

export class BrowserGatewayTokenService {
  private readonly secret: Buffer;
  private readonly now: () => number;
  readonly maximumTtlMs: number;

  constructor(options: { secret: string | Buffer; now?: () => number; maximumTtlMs?: number }) {
    this.secret = Buffer.isBuffer(options.secret)
      ? Buffer.from(options.secret)
      : Buffer.from(options.secret, "utf8");
    if (this.secret.byteLength < 32) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_SECRET_INVALID", "Gateway secret must contain at least 32 bytes.");
    }
    this.now = options.now ?? Date.now;
    this.maximumTtlMs = options.maximumTtlMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(this.maximumTtlMs) || this.maximumTtlMs < 1_000) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TTL_INVALID", "Maximum gateway token TTL is invalid.");
    }
  }

  private sign(encodedPayload: string) {
    return createHmac("sha256", this.secret).update(encodedPayload).digest("base64url");
  }

  issue(input: IssueBrowserGatewayTokenInput) {
    if (!INSTALLATION_ID_PATTERN.test(input.installationId) ||
      !isCanonicalUuid(input.userId) ||
      !isCanonicalUuid(input.threadId) ||
      !isCanonicalUuid(input.browserSessionId)) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_BINDING_INVALID", "Gateway token binding is invalid.");
    }
    const ttlMs = input.ttlMs ?? 60_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > this.maximumTtlMs) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TTL_INVALID", "Gateway token TTL is invalid.");
    }
    const issuedAt = this.now();
    const claims: BrowserGatewayClaims = {
      version: 2,
      audience: "aibrain-browser-gateway",
      tokenId: randomUUID(),
      installationId: input.installationId,
      userId: input.userId,
      threadId: input.threadId,
      browserSessionId: input.browserSessionId,
      authSessionHash: authSessionHash(input.authSessionId),
      capabilities: normalizeCapabilities(input.capabilities),
      issuedAt,
      expiresAt: issuedAt + ttlMs,
    };
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${encoded}.${this.sign(encoded)}`;
  }

  verify(token: string, expected: VerifyBrowserGatewayTokenInput) {
    if (token.length > 8_192) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TOKEN_INVALID", "Gateway token is invalid.");
    }
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TOKEN_INVALID", "Gateway token is invalid.");
    }
    const expectedSignature = this.sign(encoded);
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_SIGNATURE_INVALID", "Gateway token signature is invalid.");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TOKEN_INVALID", "Gateway token payload is invalid.");
    }
    const claims = parseClaims(decoded);
    const now = this.now();
    if (claims.expiresAt <= now) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TOKEN_EXPIRED", "Gateway token has expired.");
    }
    if (claims.issuedAt > now + 5_000 || claims.expiresAt - claims.issuedAt > this.maximumTtlMs) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_TOKEN_INVALID", "Gateway token lifetime is invalid.");
    }
    if (
      claims.installationId !== expected.installationId ||
      claims.userId !== expected.userId ||
      claims.threadId !== expected.threadId ||
      claims.browserSessionId !== expected.browserSessionId ||
      claims.authSessionHash !== authSessionHash(expected.authSessionId) ||
      !claims.capabilities.includes(expected.requiredCapability)
    ) {
      throw new BrowserGatewayTokenError("BROWSER_GATEWAY_BINDING_INVALID", "Gateway token does not match this session.");
    }
    return claims;
  }
}
