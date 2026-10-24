import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { withObservability } from "../../../../server/http/observe";
import { parseJsonBody } from "../../../../server/http/validation";
import { RateLimitError, ValidationError } from "../../../../shared/errors";
import { playEventsQuerySchema, playEventsRequestSchema } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withObservability("/v1/plays/events", async (request, obs) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);
  const body = await parseJsonBody(request, playEventsRequestSchema);

  if (!(await services.rateLimiters.playEvents.consume(user.id))) {
    throw new RateLimitError("Too many play event pushes. Try again later.");
  }

  return NextResponse.json(await services.playEvents.push(user.id, device.id, body.events));
});

export const GET = withObservability("/v1/plays/events", async (request, obs) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);

  const params = new URL(request.url).searchParams;
  const parsed = playEventsQuerySchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }

  if (!(await services.rateLimiters.playsSummary.consume(user.id))) {
    throw new RateLimitError("Too many play event requests. Try again later.");
  }

  const { from, to, cursor } = parsed.data;
  return NextResponse.json(await services.playEvents.list(user.id, device.id, from, to, cursor));
});
