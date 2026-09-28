import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // src/proxy.ts runs on every request, and Next buffers the body in memory so
    // both the proxy and the route can read it. The default cap is 10MB, which
    // silently truncates multi-track album uploads and breaks FormData parsing.
    // Raise it above what an album of large lossless files needs, but not so far
    // that a single request can force the loopback server to buffer an
    // unreasonable amount of RAM before any per-file/per-count validation runs.
    proxyClientMaxBodySize: "2gb",
  },
};

export default nextConfig;
