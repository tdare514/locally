import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** The cover of a share from a friend, for the tray's sleeve: a redirect to a short-lived signed address. */
export async function GET(_request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
  try {
    const { id } = await params;
    const url = await getServices().syncEngine.friendCoverUrl(id);
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "private, max-age=240");
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
