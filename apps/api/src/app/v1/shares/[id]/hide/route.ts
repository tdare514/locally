import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { requireAuth } from "../../../../../server/http/authContext";
import { withObservability } from "../../../../../server/http/observe";
import { parseParam } from "../../../../../server/http/validation";
import { uuidSchema } from "../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Dismiss a received share from the tray. The share itself stays valid for its other routes. */
export const POST = withObservability("/v1/shares/[id]/hide", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const shareId = parseParam((await params).id, uuidSchema);

  await services.shares.hide(user.id, shareId);
  return NextResponse.json({ ok: true });
});
