import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { parseUpdateMeta } from "../../../../server/http/validation";
import { NotFoundError } from "../../../../shared/errors";
import { demoReadOnly, isDemo } from "../../../../server/demo";
import { findDemoRelease } from "../../../../server/demo/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const release = isDemo() ? findDemoRelease(id) : await getServices().releases.get(id);
    if (!release) {
      throw new NotFoundError(`Release ${id} not found`);
    }
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
  try {
    const { id } = await params;
    const patch = parseUpdateMeta(await request.json());
    const release = await getServices().releases.update(id, patch);
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
  try {
    const { id } = await params;
    const { releases } = getServices();
    // `?forget=1` removes an adopted release from Locally without touching its files (#245).
    if (request.nextUrl.searchParams.get("forget") === "1") await releases.forget(id);
    else await releases.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
