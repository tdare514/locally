import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../server/container";
import { errorResponse } from "../../../server/http/responses";
import { requireAuth } from "../../../server/http/authContext";
import { parseParam } from "../../../server/http/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sinceVersionSchema = z.coerce.number().int().nonnegative().default(0);

export async function GET(request: Request) {
  try {
    const services = await getServices();
    const { user } = await requireAuth(request, services.auth);

    const url = new URL(request.url);
    const raw = url.searchParams.get("sinceVersion") ?? "0";
    const sinceVersion = parseParam(raw, sinceVersionSchema);

    const result = await services.releases.listSince(user.id, sinceVersion);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
