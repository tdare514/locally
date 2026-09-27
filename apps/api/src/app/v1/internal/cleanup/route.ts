import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { UnauthorizedError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The daily cron target (see `vercel.ts`): deletes tombstoned releases'
 * files once they're 30+ days old, and prunes expired auth codes. Protected
 * by `CRON_SECRET` in production; if it's unset (only expected in local
 * dev, where `.env.example` deliberately leaves it blank) the route stays
 * open so `npm run dev` + curl can exercise it without extra setup.
 */
export async function GET(request: Request) {
  try {
    const services = await getServices();

    if (services.cronSecret) {
      const header = request.headers.get("authorization");
      if (header !== `Bearer ${services.cronSecret}`) {
        throw new UnauthorizedError("Invalid or missing cron secret");
      }
    } else {
      console.warn("[sync-api] CRON_SECRET is not set — /v1/internal/cleanup is unprotected. Set it before deploying.");
    }

    const result = await services.cleanup.run();
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
