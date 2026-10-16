import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { withObservability } from "../../../../server/http/observe";
import { RateLimitError, ValidationError } from "../../../../shared/errors";
import { playsSummaryQuerySchema } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withObservability("/v1/plays/summary", async (request, obs) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);

  const params = new URL(request.url).searchParams;
  const parsed = playsSummaryQuerySchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }

  if (!(await services.rateLimiters.playsSummary.consume(user.id))) {
    throw new RateLimitError("Too many summary requests. Try again later.");
  }

  const { from, to, cursor } = parsed.data;
  return NextResponse.json(await services.plays.summary(user.id, device.id, from, to, cursor));
});
