import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { parseHideBody } from "../../../../server/http/validation";
import { demoReadOnly, isDemo } from "../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(request: NextRequest): Promise<{ id: string } | null> {
  try {
    return parseHideBody(await request.json());
  } catch {
    return null;
  }
}

/** Hide (#295): takes a waiting release out of this Mac's tray at the version it has now. Nothing is deleted. */
export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  const body = await readBody(request);
  if (!body) return badRequest("Send the release id to hide");
  try {
    await getServices().syncEngine.hideFromTray(body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Undo for Hide: the release shows in the tray again. */
export async function DELETE(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  const body = await readBody(request);
  if (!body) return badRequest("Send the release id to show again");
  try {
    await getServices().syncEngine.unhideFromTray(body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
