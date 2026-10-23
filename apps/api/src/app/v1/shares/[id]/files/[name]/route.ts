import { NextResponse } from "next/server";
import { getServices } from "../../../../../../server/container";
import { requireAuth } from "../../../../../../server/http/authContext";
import { withObservability } from "../../../../../../server/http/observe";
import { parseParam } from "../../../../../../server/http/validation";
import { uuidSchema } from "../../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string; name: string }>;
}

/** A 5-minute signed URL for the snapshot's cover or one of its track files; 404 for any other name. */
export const GET = withObservability("/v1/shares/[id]/files/[name]", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const { id, name } = await params;
  const shareId = parseParam(id, uuidSchema);

  return NextResponse.json(await services.shares.recipientFile(user.id, shareId, name));
});
