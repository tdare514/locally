import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";
import { parseCoverFile } from "../../../../../server/http/validation";
import { demoReadOnly, isDemo } from "../../../../../server/demo";
import { getDemoCover } from "../../../../../server/demo/covers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
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
    if (isDemo()) {
      const svg = getDemoCover(id);
      if (!svg) return NextResponse.json({ error: "This release has no cover image" }, { status: 404 });
      return new NextResponse(svg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        },
      });
    }
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
