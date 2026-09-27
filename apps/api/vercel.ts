import type { VercelConfig } from "@vercel/config/v1";

/**
 * Programmatic Vercel project config (replaces vercel.json). The only thing
 * this app needs beyond Vercel's Next.js defaults is the daily cleanup cron
 * — see `src/app/v1/internal/cleanup/route.ts` and `CRON_SECRET`.
 */
export const config: VercelConfig = {
  crons: [{ path: "/v1/internal/cleanup", schedule: "0 0 * * *" }],
};
