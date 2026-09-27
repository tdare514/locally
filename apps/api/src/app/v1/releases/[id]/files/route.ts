import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";
import { requireAuth } from "../../../../../server/http/authContext";
import { parseJsonBody, parseParam } from "../../../../../server/http/validation";
import { filesUploadRequestSchema, uuidSchema } from "../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const services = await getServices();
    const { user } = await requireAuth(request, services.auth);
    const { id } = await params;
    const releaseId = parseParam(id, uuidSchema);

    // 404s if the release doesn't exist yet, or belongs to another user.
    await services.releases.getOwned(user.id, releaseId);

    const body = await parseJsonBody(request, filesUploadRequestSchema);
    const uploads = await services.files.createUploads(user.id, releaseId, body.files);
    return NextResponse.json({ uploads });
  } catch (err) {
    return errorResponse(err);
  }
}
