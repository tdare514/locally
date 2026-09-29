import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";
import { parseCoverFile } from "../../../../../server/http/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const coverFile = await parseCoverFile(form);
    const release = await getServices().releases.replaceCover(id, coverFile);
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const cover = await getServices().releases.readCover(id);
    if (!cover) {
      return NextResponse.json({ error: "This release has no cover image" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(cover.bytes), {
      status: 200,
      headers: {
        "Content-Type": cover.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
