import path from "node:path";

import type { NextConfig } from "next";

const deploymentProfile = process.env.DEPLOYMENT_PROFILE ?? "local";
const objectStorageOrigin = (() => {
  try {
    return new URL(process.env.OBJECT_STORAGE_BROWSER_ENDPOINT ?? "http://127.0.0.1:9000").origin;
  } catch {
    return "http://127.0.0.1:9000";
  }
})();
const contentSecurityPolicy = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `connect-src 'self' ${objectStorageOrigin}`,
  "img-src 'self' data: blob:",
  `script-src 'self' 'unsafe-inline'${deploymentProfile === "local" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  ...(deploymentProfile === "production" ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
] as const;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
};

export default nextConfig;
