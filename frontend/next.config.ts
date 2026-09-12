import path from "node:path";
import type { NextConfig } from "next";

// Server-capable build only: the app relies on route handlers, cookies and
// request-time rendering, so it is hosted on AWS Amplify (not a static export).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Pin tracing to this app so stray lockfiles in parent folders are ignored.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
