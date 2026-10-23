import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { requireAuth } from "../../../../../server/http/authContext";
import { withObservability } from "../../../../../server/http/observe";
import { parseJsonBody, parseParam } from "../../../../../server/http/validation";
import { RateLimitError } from "../../../../../shared/errors";
import { reshareRequestSchema, uuidSchema } from "../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export const POST = withObservability("/v1/shares/[id]/reshare", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const shareId = parseParam((await params).id, uuidSchema);
  // Create and reshare share one allowance per user.
  if (!(await services.rateLimiters.shareCreate.consume(user.id))) throw new RateLimitError("Too many shares. Try again later.");
  const body = await parseJsonBody(request, reshareRequestSchema);

  const result = await services.shares.reshare(user, shareId, body, new URL(request.url).origin);
  return NextResponse.json(result, { status: result.share ? 201 : 200 });
});
