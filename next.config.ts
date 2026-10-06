import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // pg-boss loads pg at runtime; keep both as plain Node modules in the standalone output.
  serverExternalPackages: ["pg-boss", "pg"],
  // OAuth / MCP discovery documents (RFC 8414, RFC 9728, OIDC) for Claude (ADR-038).
  async rewrites() {
    return [{ source: "/.well-known/:path*", destination: "/api/well-known/:path*" }];
  },
};

export default withNextIntl(nextConfig);
