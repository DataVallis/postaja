import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // pg-boss loads pg at runtime; Satori loads its WebAssembly (yoga, harfbuzz) from its own folder. Keep them as plain
  // Node modules in the standalone output.
  serverExternalPackages: ["pg-boss", "pg", "satori"],
  // The user guide (TASK-026) is read from docs/guides/user at request time; ship the Markdown with the help pages.
  outputFileTracingIncludes: { "/app/help": ["./docs/guides/user/**/*.md"], "/app/help/*": ["./docs/guides/user/**/*.md"], "/api/help/pdf": ["./docs/guides/user/**/*.md"] },
  // OAuth / MCP discovery documents (RFC 8414, RFC 9728, OIDC) for Claude (ADR-038).
  async rewrites() {
    return [{ source: "/.well-known/:path*", destination: "/api/well-known/:path*" }];
  },
};

export default withNextIntl(nextConfig);
