import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_URL_BYTES = 8_192;
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_CACHE_ENTRIES = 256;
const DEFAULT_MAX_ADDRESSES = 16;

const CLOUD_METADATA_HOSTNAMES = new Set([
  "instance-data.ec2.internal",
  "metadata.azure.internal",
  "metadata.google",
  "metadata.google.internal",
  "metadata.oraclecloud.com",
]);

export class BrowserNetworkPolicyError extends Error {
  constructor(readonly code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BrowserNetworkPolicyError";
  }
}

export type BrowserDnsAddress = Readonly<{
  address: string;
  family: number;
}>;

export type BrowserDnsLookup = (
  hostname: string,
  options: Readonly<{ all: true; verbatim: true }>,
) => Promise<readonly BrowserDnsAddress[]>;

export type BrowserNetworkPolicyOptions = {
  lookup?: BrowserDnsLookup;
  ttlMs?: number;
  maxCacheEntries?: number;
  maxAddresses?: number;
  allowPrivateNetwork?: boolean;
  now?: () => number;
};

export type BrowserNetworkDecision = Readonly<{
  url: string;
  hostname: string | null;
  addresses: readonly string[];
  fromCache: boolean;
}>;

type CacheEntry = Readonly<{
  addresses: readonly string[];
  expiresAt: number;
}>;

function boundedPositiveInteger(name: string, value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new BrowserNetworkPolicyError(
      "BROWSER_NETWORK_OPTIONS_INVALID",
      `${name} must be between 1 and ${maximum}.`,
    );
  }
  return value;
}

function parseIpv4(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

function ipv4Prefix(address: number, prefix: string, bits: number) {
  const expected = parseIpv4(prefix);
  if (expected === null) return false;
  const mask = bits === 0 ? 0 : (0xffff_ffff << (32 - bits)) >>> 0;
  return (address & mask) === (expected & mask);
}

function isGlobalIpv4(address: string) {
  const value = parseIpv4(address);
  if (value === null) return false;
  if (ipv4Prefix(value, "0.0.0.0", 8) ||
    ipv4Prefix(value, "10.0.0.0", 8) ||
    ipv4Prefix(value, "100.64.0.0", 10) ||
    ipv4Prefix(value, "127.0.0.0", 8) ||
    ipv4Prefix(value, "169.254.0.0", 16) ||
    ipv4Prefix(value, "172.16.0.0", 12) ||
    ipv4Prefix(value, "192.0.2.0", 24) ||
    ipv4Prefix(value, "192.88.99.0", 24) ||
    ipv4Prefix(value, "192.168.0.0", 16) ||
    ipv4Prefix(value, "198.18.0.0", 15) ||
    ipv4Prefix(value, "198.51.100.0", 24) ||
    ipv4Prefix(value, "203.0.113.0", 24) ||
    ipv4Prefix(value, "224.0.0.0", 4) ||
    ipv4Prefix(value, "240.0.0.0", 4)) {
    return false;
  }
  if (ipv4Prefix(value, "192.0.0.0", 24)) {
    return address === "192.0.0.9" || address === "192.0.0.10";
  }
  return true;
}

function parseIpv6(address: string) {
  if (address.includes("%") || address.split("::").length > 2) return null;
  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  if (normalized.includes(".") && lastColon >= 0) {
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (ipv4 === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const hasCompression = normalized.includes("::");
  const [leftValue, rightValue = ""] = normalized.split("::");
  const left = leftValue ? leftValue.split(":") : [];
  const right = rightValue ? rightValue.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((!hasCompression && missing !== 0) || (hasCompression && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6Prefix(address: bigint, prefix: string, bits: number) {
  const expected = parseIpv6(prefix);
  if (expected === null) return false;
  return (address >> BigInt(128 - bits)) === (expected >> BigInt(128 - bits));
}

function isGlobalIpv6(address: string) {
  const value = parseIpv6(address);
  if (value === null || !ipv6Prefix(value, "2000::", 3)) return false;
  return !ipv6Prefix(value, "2001::", 32) &&
    !ipv6Prefix(value, "2001:2::", 48) &&
    !ipv6Prefix(value, "2001:10::", 28) &&
    !ipv6Prefix(value, "2001:20::", 28) &&
    !ipv6Prefix(value, "2001:db8::", 32) &&
    !ipv6Prefix(value, "2002::", 16) &&
    !ipv6Prefix(value, "3fff::", 20);
}

export function isGlobalNetworkAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isGlobalIpv4(address);
  if (family === 6) return isGlobalIpv6(address);
  return false;
}

function normalizeHostname(value: string) {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  const normalized = unbracketed.toLowerCase().replace(/\.$/u, "");
  if (!normalized || normalized.length > 253 || /[\u0000-\u0020\u007f]/u.test(normalized)) {
    throw new BrowserNetworkPolicyError("BROWSER_NETWORK_URL_INVALID", "Browser hostname is invalid.");
  }
  if (isIP(normalized)) return normalized;
  const labels = normalized.split(".");
  if (labels.some((label) =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new BrowserNetworkPolicyError("BROWSER_NETWORK_URL_INVALID", "Browser hostname is invalid.");
  }
  return normalized;
}

function metadataOrLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    CLOUD_METADATA_HOSTNAMES.has(hostname);
}

function validateUrl(value: string) {
  if (value === "about:blank") return { url: value, hostname: null };
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_URL_BYTES) {
    throw new BrowserNetworkPolicyError("BROWSER_NETWORK_URL_INVALID", "Browser URL is invalid or too long.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new BrowserNetworkPolicyError("BROWSER_NETWORK_URL_INVALID", "Browser URL is invalid.", { cause: error });
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username || parsed.password || !parsed.hostname) {
    throw new BrowserNetworkPolicyError(
      "BROWSER_NETWORK_URL_REJECTED",
      "Only credential-free HTTP, HTTPS and about:blank browser URLs are allowed.",
    );
  }
  return { url: parsed.toString(), hostname: normalizeHostname(parsed.hostname) };
}

function validateDnsResult(
  value: readonly BrowserDnsAddress[],
  maxAddresses: number,
) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BrowserNetworkPolicyError("BROWSER_NETWORK_DNS_EMPTY", "DNS returned no addresses.");
  }
  if (value.length > maxAddresses) {
    throw new BrowserNetworkPolicyError("BROWSER_NETWORK_DNS_TOO_MANY", "DNS returned too many addresses.");
  }
  const addresses = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.address !== "string" ||
      (item.family !== 4 && item.family !== 6) || isIP(item.address) !== item.family) {
      throw new BrowserNetworkPolicyError("BROWSER_NETWORK_DNS_INVALID", "DNS returned an invalid address.");
    }
    addresses.add(item.address.toLowerCase());
  }
  return Object.freeze([...addresses]);
}

export class BrowserNetworkPolicy {
  private readonly lookup: BrowserDnsLookup;
  private readonly ttlMs: number;
  private readonly maxCacheEntries: number;
  private readonly maxAddresses: number;
  private readonly allowPrivateNetwork: boolean;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<readonly string[]>>();

  constructor(options: BrowserNetworkPolicyOptions = {}) {
    if (options.allowPrivateNetwork && process.env.NODE_ENV === "production") {
      throw new BrowserNetworkPolicyError(
        "BROWSER_NETWORK_PRODUCTION_OVERRIDE_FORBIDDEN",
        "Private browser networking cannot be enabled in production.",
      );
    }
    this.lookup = options.lookup ?? dnsLookup;
    this.ttlMs = boundedPositiveInteger("ttlMs", options.ttlMs ?? DEFAULT_TTL_MS, 3_600_000);
    this.maxCacheEntries = boundedPositiveInteger(
      "maxCacheEntries",
      options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
      10_000,
    );
    this.maxAddresses = boundedPositiveInteger(
      "maxAddresses",
      options.maxAddresses ?? DEFAULT_MAX_ADDRESSES,
      256,
    );
    this.allowPrivateNetwork = options.allowPrivateNetwork === true;
    this.now = options.now ?? Date.now;
  }

  get cacheSize() {
    return this.cache.size;
  }

  async assertAllowed(value: string): Promise<BrowserNetworkDecision> {
    const parsed = validateUrl(value);
    if (parsed.hostname === null) {
      return Object.freeze({ url: parsed.url, hostname: null, addresses: Object.freeze([]), fromCache: false });
    }
    if (this.allowPrivateNetwork) {
      return Object.freeze({ url: parsed.url, hostname: parsed.hostname, addresses: Object.freeze([]), fromCache: false });
    }
    if (metadataOrLocalHostname(parsed.hostname)) {
      throw new BrowserNetworkPolicyError(
        "BROWSER_NETWORK_PRIVATE_DESTINATION",
        "Private, local and cloud metadata browser destinations are forbidden.",
      );
    }

    const literalFamily = isIP(parsed.hostname);
    const resolved = literalFamily
      ? { addresses: Object.freeze([parsed.hostname]), fromCache: false }
      : await this.resolve(parsed.hostname);
    if (resolved.addresses.some((address) => !isGlobalNetworkAddress(address))) {
      throw new BrowserNetworkPolicyError(
        "BROWSER_NETWORK_PRIVATE_DESTINATION",
        "DNS resolved to a non-global browser destination.",
      );
    }
    return Object.freeze({
      url: parsed.url,
      hostname: parsed.hostname,
      addresses: resolved.addresses,
      fromCache: resolved.fromCache,
    });
  }

  private async resolve(hostname: string) {
    const cached = this.cache.get(hostname);
    if (cached) {
      if (cached.expiresAt > this.now()) {
        this.cache.delete(hostname);
        this.cache.set(hostname, cached);
        return { addresses: cached.addresses, fromCache: true };
      }
      this.cache.delete(hostname);
    }

    let pending = this.inflight.get(hostname);
    if (!pending) {
      if (this.inflight.size >= this.maxCacheEntries) {
        throw new BrowserNetworkPolicyError(
          "BROWSER_NETWORK_DNS_BACKPRESSURE",
          "Browser DNS resolution capacity is saturated.",
        );
      }
      pending = this.lookup(hostname, { all: true, verbatim: true })
        .then((addresses) => validateDnsResult(addresses, this.maxAddresses))
        .catch((error: unknown) => {
          if (error instanceof BrowserNetworkPolicyError) throw error;
          throw new BrowserNetworkPolicyError(
            "BROWSER_NETWORK_DNS_FAILED",
            "Browser DNS resolution failed.",
            { cause: error },
          );
        });
      this.inflight.set(hostname, pending);
    }

    try {
      const addresses = await pending;
      this.cache.set(hostname, { addresses, expiresAt: this.now() + this.ttlMs });
      while (this.cache.size > this.maxCacheEntries) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      return { addresses, fromCache: false };
    } finally {
      if (this.inflight.get(hostname) === pending) this.inflight.delete(hostname);
    }
  }
}
