import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // src/proxy.ts runs on every request, and Next buffers the body in memory so
    // both the proxy and the route can read it. The default cap is 10MB, which
    // silently truncates multi-track album uploads and breaks FormData parsing.
    // Raise it well above what an album of large lossless files needs; this is a
    // loopback-only app so the memory cost is acceptable.
    proxyClientMaxBodySize: "4gb",
  },
};

export default nextConfig;
