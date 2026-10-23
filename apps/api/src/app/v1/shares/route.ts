import { NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import { withObservability } from "../../../server/http/observe";
import { parseJsonBody } from "../../../server/http/validation";
import { RateLimitError, ValidationError } from "../../../shared/errors";
import { createShareRequestSchema, listSharesQuerySchema } from "../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withObservability("/v1/shares", async (request, obs) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  if (!(await services.rateLimiters.shareCreate.consume(user.id))) throw new RateLimitError("Too many shares. Try again later.");
  const body = await parseJsonBody(request, createShareRequestSchema);

  const result = await services.shares.create(user, body, new URL(request.url).origin);
  return NextResponse.json(result, { status: result.share ? 201 : 200 });
});

export const GET = withObservability("/v1/shares", async (request, obs) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const params = new URL(request.url).searchParams;
  const parsed = listSharesQuerySchema.safeParse({
    role: params.get("role") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`).join("; "));
  }
  const query = parsed.data;

  const page =
    query.role === "sent"
      ? await services.shares.listSent(user.id, query.cursor, query.limit)
      : await services.shares.listReceived(user.id, query.cursor, query.limit);
  return NextResponse.json(page);
});
