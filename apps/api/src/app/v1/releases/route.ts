import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import { parseParam } from "../../../server/http/validation";
import { withObservability } from "../../../server/http/observe";
import { RELEASE_PAGE_MAX } from "../../../server/releases/ReleaseSyncService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sinceVersionSchema = z.coerce.number().int().nonnegative().default(0);
const limitSchema = z.coerce.number().int().positive().default(RELEASE_PAGE_MAX);

export const GET = withObservability("/v1/releases", async (request, obs) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);

  const url = new URL(request.url);
  const rawSinceVersion = url.searchParams.get("sinceVersion") ?? "0";
  const sinceVersion = parseParam(rawSinceVersion, sinceVersionSchema);

  const rawLimit = url.searchParams.get("limit") ?? String(RELEASE_PAGE_MAX);
  const limit = Math.min(parseParam(rawLimit, limitSchema), RELEASE_PAGE_MAX);

  const result = await services.releases.listSince(user.id, sinceVersion, limit);
  return NextResponse.json(result);
});
