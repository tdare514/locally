import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** "Send to Spotify" on a share from a friend: claims it, downloads it, writes a new release into the library. */
export async function POST(_request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
  try {
    const { id } = await params;
    const release = await getServices().syncEngine.acceptFriendShare(id);
    return NextResponse.json({ ok: true, release });
  } catch (err) {
    return errorResponse(err);
  }
}
