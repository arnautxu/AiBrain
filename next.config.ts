import type { NextConfig } from "next";

const scriptSource = process.env.NODE_ENV === "development"
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./config/installations/vercel-preview.example.json"],
  },
  // Vercel owns the framework build output. The standalone bundle is only for
  // the persistent Docker/host target where Codex App Server can run.
  ...(process.env.VERCEL === "1" ? {} : { output: "standalone" as const }),
  // The private worker gateway needs the real Node `ws` implementation at
  // runtime. Keeping it external avoids framework bundlers substituting their
  // own WebSocket shim in API-route chunks.
  serverExternalPackages: ["ws"],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "connect-src 'self'",
              "font-src 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "img-src 'self' data: blob:",
              "media-src 'self' blob:",
              "object-src 'none'",
              scriptSource,
              "style-src 'self' 'unsafe-inline'",
              "worker-src 'self' blob:",
            ].join("; "),
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
