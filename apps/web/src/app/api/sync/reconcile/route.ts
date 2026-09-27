import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Sync now": run one reconcile pass and return the fresh status. Never rejects on sync errors - they land in `lastError`. */
export async function POST() {
  try {
    const services = getServices();
    await services.syncEngine.reconcile();
    const status = await services.syncEngine.status();
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
