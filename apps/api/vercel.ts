import type { VercelConfig } from "@vercel/config/v1";

/**
 * Programmatic Vercel project config (replaces vercel.json). Beyond Vercel's
 * Next.js defaults this app needs the daily cleanup cron — see
 * `src/app/v1/internal/cleanup/route.ts` and `CRON_SECRET` — and a skip rule
 * so pushes that only touch the other apps in the monorepo don't redeploy it.
 */
export const config: VercelConfig = {
  crons: [{ path: "/v1/internal/cleanup", schedule: "0 0 * * *" }],
  // Runs in apps/api; exit 0 skips the build. Diffs against the last deployed
  // commit rather than HEAD^ so a multi-commit push is judged as a whole. With
  // no previous deploy, or that commit missing from the shallow clone, the
  // test or git fails and the build goes ahead.
  ignoreCommand: 'test -n "$VERCEL_GIT_PREVIOUS_SHA" && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .',
};
