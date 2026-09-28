import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { withObservability } from "../../../../server/http/observe";
import { UnauthorizedError } from "../../../../shared/errors";

/** Timing-safe compare of the request's bearer header against the expected `Bearer <secret>`. */
function isValidCronBearer(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The daily cron target (see `vercel.ts`): deletes tombstoned releases'
 * files once they're 30+ days old, and prunes expired auth codes. Protected
 * by `CRON_SECRET` in production; if it's unset (only expected in local
 * dev, where `.env.example` deliberately leaves it blank) the route stays
 * open so `npm run dev` + curl can exercise it without extra setup.
 *
 * Also a cost guardrail (#29): logs the total bytes stored across every
 * file, at "warn" once it reaches `STORAGE_ALERT_BYTES` (see README.md).
 */
export const GET = withObservability("/v1/internal/cleanup", async (request) => {
  const services = await getServices();

  if (services.cronSecret) {
    const header = request.headers.get("authorization");
    if (!isValidCronBearer(header, services.cronSecret)) {
      throw new UnauthorizedError("Invalid or missing cron secret");
    }
  } else {
    console.warn("[sync-api] CRON_SECRET is not set — /v1/internal/cleanup is unprotected. Set it before deploying.");
  }

  const result = await services.cleanup.run();

  const overAlert = result.totalStoredBytes >= services.storageAlertBytes;
  const level = overAlert ? "warn" : "info";
  const line = JSON.stringify({
    level,
    event: "storage_total",
    totalStoredBytes: result.totalStoredBytes,
    alertBytes: services.storageAlertBytes,
  });
  if (overAlert) console.warn(line);
  else console.log(line);

  return NextResponse.json(result);
});
