import path from "node:path";
import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_IMAGE_EXT } from "../../../../../lib/types";
import { getRelease, replaceCover, NotFoundError } from "../../../../../lib/releases";
import { badRequest, errorResponse } from "../../../../../lib/http";
import { MAX_COVER_BYTES, sniffImageMime } from "../../../../../lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

function hasExt(name: string, exts: readonly string[]): boolean {
  return exts.includes(path.extname(name).toLowerCase());
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const coverEntry = form.get("cover");
    if (!(coverEntry instanceof File) || coverEntry.size === 0) {
      return badRequest("cover file is required");
    }
    if (!hasExt(coverEntry.name, SUPPORTED_IMAGE_EXT)) {
      return badRequest(`Unsupported cover image type: ${coverEntry.name}`);
    }
    if (coverEntry.size > MAX_COVER_BYTES) {
      return badRequest("Cover image must be 10MB or smaller");
    }
    if (!(await sniffImageMime(coverEntry))) {
      return badRequest("Cover image must be a real JPEG or PNG");
    }

    const release = await replaceCover(id, coverEntry);
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}

function mimeForExt(ext: string): string {
  if (ext === ".png") return "image/png";
  return "image/jpeg";
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const release = await getRelease(id);
    if (!release) {
      throw new NotFoundError(`Release ${id} not found`);
    }
    if (!release.coverPath) {
      return NextResponse.json({ error: "This release has no cover image" }, { status: 404 });
    }

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(release.coverPath);
    } catch {
      return NextResponse.json({ error: "Cover file is missing on disk" }, { status: 404 });
    }

    const ext = path.extname(release.coverPath).toLowerCase();
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mimeForExt(ext),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
