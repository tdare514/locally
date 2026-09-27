import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { parseUpdateMeta } from "../../../../server/http/validation";
import { NotFoundError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const release = await getServices().releases.get(id);
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
    const patch = parseUpdateMeta(await request.json());
    const release = await getServices().releases.update(id, patch);
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await getServices().releases.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
