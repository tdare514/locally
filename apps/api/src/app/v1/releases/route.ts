import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import { parseParam } from "../../../server/http/validation";
import { withObservability } from "../../../server/http/observe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sinceVersionSchema = z.coerce.number().int().nonnegative().default(0);

export const GET = withObservability("/v1/releases", async (request, obs) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);

  const url = new URL(request.url);
  const raw = url.searchParams.get("sinceVersion") ?? "0";
  const sinceVersion = parseParam(raw, sinceVersionSchema);

  const result = await services.releases.listSince(user.id, sinceVersion);
  return NextResponse.json(result);
});
