import path from "node:path";
import type { NextConfig } from "next";

// Server-capable build only: the app relies on route handlers, cookies and
// request-time rendering, so it is hosted on AWS Amplify (not a static export).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Pin tracing to this app so stray lockfiles in parent folders are ignored.
  outputFileTracingRoot: path.join(__dirname),
  // Node-only database drivers stay out of the bundler and load at runtime.
  serverExternalPackages: ["pg", "@aws/aurora-dsql-node-postgres-connector"],
  // Groups are one per official neighborhood now; the prototype's sample group links point at their neighborhood's
  // group (same map as LEGACY_GROUP_SLUGS in src/lib/data.ts).
  async redirects() {
    const legacy: Record<string, string> = {
      "niles-neighbors": "niles",
      "irvington-commons": "irvington",
      "centerville-together": "centerville",
      "warm-springs-hillside": "warm-springs",
    };
    return Object.entries(legacy).flatMap(([from, to]) => [
      { source: `/g/${from}`, destination: `/g/${to}`, permanent: true },
      { source: `/g/${from}/:path*`, destination: `/g/${to}/:path*`, permanent: true },
    ]);
  },
};

export default nextConfig;
