import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { requireAuth } from "../../../../server/http/authContext";
import { parseParam } from "../../../../server/http/validation";
import { uuidSchema } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const services = await getServices();
    const { user } = await requireAuth(request, services.auth);
    const { id } = await params;
    const deviceId = parseParam(id, uuidSchema);

    await services.auth.revokeDevice(user.id, deviceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
