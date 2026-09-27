import { NextResponse } from "next/server";
import { getServices } from "../../../../../../server/container";
import { errorResponse } from "../../../../../../server/http/responses";
import { requireAuth } from "../../../../../../server/http/authContext";
import { parseParam } from "../../../../../../server/http/validation";
import { fileNameSchema, uuidSchema } from "../../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const services = await getServices();
    const { user } = await requireAuth(request, services.auth);
    const { id, name } = await params;
    const releaseId = parseParam(id, uuidSchema);
    const fileName = parseParam(name, fileNameSchema);

    await services.releases.getOwned(user.id, releaseId);
    const ticket = await services.files.createDownload(user.id, releaseId, fileName);
    return NextResponse.json(ticket);
  } catch (err) {
    return errorResponse(err);
  }
}
