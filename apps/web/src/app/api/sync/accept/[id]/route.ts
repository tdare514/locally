import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** "Send to Spotify" on a pending phone release: downloads its files and imports it locally with the same id. */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const release = await getServices().syncEngine.acceptFromPhone(id);
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    return errorResponse(err);
  }
}
