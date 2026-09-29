import type { VercelConfig } from "@vercel/config/v1";

/**
 * Programmatic Vercel project config (replaces vercel.json). Beyond Vercel's
 * Next.js defaults this app needs the daily cleanup cron — see
 * `src/app/v1/internal/cleanup/route.ts` and `CRON_SECRET` — a build command
 * that migrates the database, and a skip rule so pushes that only touch the
 * other apps in the monorepo don't redeploy it.
 */
export const config: VercelConfig = {
  crons: [{ path: "/v1/internal/cleanup", schedule: "0 0 * * *" }],
  // Migrations run once per deploy, here, not on every cold start. A failed
  // migration fails the build, so the previous deployment keeps serving.
  // Previews have no database variables, so the script skips there and can
  // never touch the production database (#90).
  buildCommand: "npm run db:migrate && next build",
  // Runs in apps/api; exit 0 skips the build, exit 1 builds. Diffs against the
  // last successfully deployed commit rather than HEAD^ so a multi-commit push
  // is judged as a whole. Vercel clones shallowly, so that commit can be
  // missing; git would then exit 128, which Vercel treats as a failed
  // deployment rather than "build" (#57). The rev-parse guard turns that case
  // into exit 1, as does an empty variable on the first deploy. A redeploy of
  // the last successful commit has both SHAs equal and must build, not be
  // cancelled by an empty diff (#90). Redeploying an older deployment is still
  // judged by the diff; `vercel deploy --prod` is the fallback for that.
  ignoreCommand:
    'test -n "$VERCEL_GIT_PREVIOUS_SHA" && test "$VERCEL_GIT_PREVIOUS_SHA" != "$VERCEL_GIT_COMMIT_SHA" && git rev-parse --verify --quiet "$VERCEL_GIT_PREVIOUS_SHA^{commit}" >/dev/null && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .',
};
