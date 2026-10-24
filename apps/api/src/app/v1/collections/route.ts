import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import { parseParam } from "../../../server/http/validation";
import { withObservability } from "../../../server/http/observe";
import { COLLECTION_PAGE_MAX } from "../../../server/collections/CollectionSyncService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sinceVersionSchema = z.coerce.number().int().nonnegative().default(0);
const limitSchema = z.coerce.number().int().positive().default(COLLECTION_PAGE_MAX);

export const GET = withObservability("/v1/collections", async (request, obs) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);

  const url = new URL(request.url);
  const sinceVersion = parseParam(url.searchParams.get("sinceVersion") ?? "0", sinceVersionSchema);
  const limit = Math.min(parseParam(url.searchParams.get("limit") ?? String(COLLECTION_PAGE_MAX), limitSchema), COLLECTION_PAGE_MAX);

  const result = await services.collections.listSince(user.id, sinceVersion, limit);
  return NextResponse.json(result);
});
