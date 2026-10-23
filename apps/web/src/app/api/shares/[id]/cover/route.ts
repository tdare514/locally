import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** The cover of a share from a friend, for the tray's sleeve: read from the cache, never from the service. */
export async function GET(_request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
  try {
    const { id } = await params;
    const { bytes, contentType } = await getServices().syncEngine.friendCover(id);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    return errorResponse(err);
  }
}
