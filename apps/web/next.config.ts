import type { NextConfig } from "next";

// LOCALLY_DESKTOP_BUILD is set only by `npm run desktop:build`; it keeps
// `npm run dev` / `npm start` unchanged. The Electron shell runs the standalone server.
const desktopBuild = process.env.LOCALLY_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  output: desktopBuild ? "standalone" : undefined,
  // apps/web is the tracing root, so the standalone tree is `.next/standalone/server.js`.
  ...(desktopBuild ? { outputFileTracingRoot: process.cwd() } : {}),
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
