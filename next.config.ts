import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel owns the framework build output. The standalone bundle is only for
  // the persistent Docker/host target where Codex App Server can run.
  ...(process.env.VERCEL === "1" ? {} : { output: "standalone" as const }),
  reactStrictMode: true,
};

export default nextConfig;
