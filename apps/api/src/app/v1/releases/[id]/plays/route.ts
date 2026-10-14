import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { requireAuth } from "../../../../../server/http/authContext";
import { parseParam } from "../../../../../server/http/validation";
import { withObservability } from "../../../../../server/http/observe";
import { NotFoundError } from "../../../../../shared/errors";
import { uuidSchema } from "../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export const GET = withObservability("/v1/releases/[id]/plays", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);
  const { id } = await params;
  const releaseId = parseParam(id, uuidSchema);

  const result = await services.plays.forRelease(user.id, releaseId, device.id);
  if (!result) throw new NotFoundError("Release not found");
  return NextResponse.json(result);
});
