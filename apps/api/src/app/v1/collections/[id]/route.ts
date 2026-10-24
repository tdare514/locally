import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { parseJsonBody, parseParam } from "../../../../server/http/validation";
import { withObservability } from "../../../../server/http/observe";
import { collectionRecordSchema } from "../../../../shared/collections";
import { uuidSchema } from "../../../../shared/types";
import { RateLimitError, ValidationError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export const PUT = withObservability("/v1/collections/[id]", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  if (!(await services.rateLimiters.collectionWrites.consume(user.id))) {
    throw new RateLimitError("Too many collection writes. Try again later.");
  }
  const { id } = await params;
  const collectionId = parseParam(id, uuidSchema);

  const record = await parseJsonBody(request, collectionRecordSchema);
  if (record.id !== collectionId) {
    throw new ValidationError("Body id must match the collection id in the URL");
  }

  const result = await services.collections.upsert(user.id, collectionId, record);
  return NextResponse.json(result);
});

export const DELETE = withObservability("/v1/collections/[id]", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  if (!(await services.rateLimiters.collectionWrites.consume(user.id))) {
    throw new RateLimitError("Too many collection writes. Try again later.");
  }
  const { id } = await params;
  const collectionId = parseParam(id, uuidSchema);

  const result = await services.collections.tombstone(user.id, collectionId);
  return NextResponse.json(result);
});
