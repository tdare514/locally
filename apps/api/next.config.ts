import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Baseline security headers for every response. `no-store` is safe here
   * because this app has no pages and no cacheable GETs worth serving stale
   * (every route is either auth-scoped JSON or a signed, single-use URL).
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
