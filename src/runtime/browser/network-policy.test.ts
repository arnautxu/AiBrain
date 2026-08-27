import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserNetworkPolicy,
  BrowserNetworkPolicyError,
  isGlobalNetworkAddress,
  type BrowserDnsLookup,
} from "@/runtime/browser/network-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BrowserNetworkPolicy", () => {
  it("allows only globally routable results and rejects mixed DNS answers", async () => {
    const lookup: BrowserDnsLookup = async (hostname) => hostname === "public.example"
      ? [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]
      : [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.7", family: 4 }];
    const policy = new BrowserNetworkPolicy({ lookup });

    await expect(policy.assertAllowed("https://public.example/path")).resolves.toMatchObject({
      hostname: "public.example",
      addresses: ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
    });
    await expect(policy.assertAllowed("https://mixed.example/redirect"))
      .rejects.toMatchObject({ code: "BROWSER_NETWORK_PRIVATE_DESTINATION" });
  });

  it("blocks loopback, private, link-local, metadata and non-global IPv4/IPv6 literals", async () => {
    const policy = new BrowserNetworkPolicy();
    const rejected = [
      "http://localhost/",
      "http://api.localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://100.100.100.200/",
      "http://[::1]/",
      "http://[fe80::a9fe:a9fe]/",
      "http://[fd00:ec2::254]/",
      "http://[2001:db8::1]/",
    ];
    for (const url of rejected) {
      await expect(policy.assertAllowed(url)).rejects.toMatchObject({
        code: "BROWSER_NETWORK_PRIVATE_DESTINATION",
      });
    }
    await expect(policy.assertAllowed("http://93.184.216.34/")).resolves.toMatchObject({
      addresses: ["93.184.216.34"],
    });
  });

  it("fails closed for DNS errors, empty, malformed and excessive result sets", async () => {
    const cases: Array<{ result: unknown; code: string }> = [
      { result: [], code: "BROWSER_NETWORK_DNS_EMPTY" },
      { result: [{ address: "not-an-ip", family: 4 }], code: "BROWSER_NETWORK_DNS_INVALID" },
      {
        result: Array.from({ length: 3 }, (_, index) => ({ address: `93.184.216.${index + 1}`, family: 4 })),
        code: "BROWSER_NETWORK_DNS_TOO_MANY",
      },
    ];
    for (const [index, item] of cases.entries()) {
      const policy = new BrowserNetworkPolicy({
        maxAddresses: 2,
        lookup: async () => item.result as never,
      });
      await expect(policy.assertAllowed(`https://failure-${index}.example/`))
        .rejects.toMatchObject({ code: item.code });
    }
    const failed = new BrowserNetworkPolicy({ lookup: async () => { throw new Error("resolver offline"); } });
    await expect(failed.assertAllowed("https://dns-error.example/"))
      .rejects.toMatchObject({ code: "BROWSER_NETWORK_DNS_FAILED" });
  });

  it("uses bounded TTL cache, coalesces lookup and re-resolves after expiry", async () => {
    let now = 1_000;
    let calls = 0;
    const lookup: BrowserDnsLookup = async () => {
      calls += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    };
    const policy = new BrowserNetworkPolicy({
      lookup,
      ttlMs: 100,
      maxCacheEntries: 2,
      now: () => now,
    });
    const firstPair = await Promise.all([
      policy.assertAllowed("https://one.example/a"),
      policy.assertAllowed("https://one.example/b"),
    ]);
    expect(calls).toBe(1);
    expect(firstPair.every((decision) => decision.fromCache === false)).toBe(true);
    await expect(policy.assertAllowed("https://one.example/c")).resolves.toMatchObject({ fromCache: true });
    await policy.assertAllowed("https://two.example/");
    await policy.assertAllowed("https://three.example/");
    expect(policy.cacheSize).toBe(2);
    await policy.assertAllowed("https://one.example/d");
    expect(calls).toBe(4);
    now += 101;
    await policy.assertAllowed("https://one.example/e");
    expect(calls).toBe(5);
  });

  it("allows an explicit development bypass but forbids it in production", async () => {
    const policy = new BrowserNetworkPolicy({ allowPrivateNetwork: true });
    await expect(policy.assertAllowed("http://127.0.0.1:3000/")).resolves.toMatchObject({
      hostname: "127.0.0.1",
      addresses: [],
    });
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new BrowserNetworkPolicy({ allowPrivateNetwork: true })).toThrowError(
      expect.objectContaining({ code: "BROWSER_NETWORK_PRODUCTION_OVERRIDE_FORBIDDEN" }),
    );
    expect(() => new BrowserNetworkPolicy({ allowPrivateNetwork: true }))
      .toThrow(BrowserNetworkPolicyError);
  });
});

describe("isGlobalNetworkAddress", () => {
  it("classifies public and non-global address ranges", () => {
    expect(isGlobalNetworkAddress("8.8.8.8")).toBe(true);
    expect(isGlobalNetworkAddress("192.0.0.9")).toBe(true);
    expect(isGlobalNetworkAddress("192.168.1.1")).toBe(false);
    expect(isGlobalNetworkAddress("2606:4700:4700::1111")).toBe(true);
    expect(isGlobalNetworkAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isGlobalNetworkAddress("ff02::1")).toBe(false);
  });
});
