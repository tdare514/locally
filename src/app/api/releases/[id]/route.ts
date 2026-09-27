import { NextRequest, NextResponse } from "next/server";
import type { UpdateReleaseMeta } from "../../../../lib/types";
import { getRelease, updateRelease, deleteRelease, NotFoundError } from "../../../../lib/releases";
import { errorResponse } from "../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const release = await getRelease(id);
    if (!release) {
      throw new NotFoundError(`Release ${id} not found`);
    }
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const patch = (await request.json()) as UpdateReleaseMeta;
    const release = await updateRelease(id, patch);
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await deleteRelease(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
