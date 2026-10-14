import { NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import { parseJsonBody } from "../../../server/http/validation";
import { withObservability } from "../../../server/http/observe";
import { playCountsRequestSchema } from "../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withObservability("/v1/plays", async (request, obs) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);
  const body = await parseJsonBody(request, playCountsRequestSchema);

  const result = await services.plays.push(user.id, device.id, body.counts);
  return NextResponse.json(result);
});
