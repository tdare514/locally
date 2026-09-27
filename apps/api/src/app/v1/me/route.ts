import { NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { errorResponse } from "../../../server/http/responses";
import { requireAuth } from "../../../server/http/authContext";
import type { MeResponse } from "../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const services = await getServices();
    const { user, device } = await requireAuth(request, services.auth);

    const [usedBytes, limitBytes, devices] = await Promise.all([
      services.quota.usedBytes(user.id),
      services.quota.limitBytes(user.id),
      services.auth.listDevices(user.id),
    ]);

    const response: MeResponse = {
      user,
      device: { id: device.id, name: device.name },
      quota: { usedBytes, limitBytes },
      devices,
    };
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}
