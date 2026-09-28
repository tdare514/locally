import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { errorResponse } from "../../../../../server/http/responses";
import { parseCoverFile } from "../../../../../server/http/validation";
import { NotFoundError } from "../../../../../shared/errors";

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

function mimeForExt(ext: string): string {
  if (ext === ".png") return "image/png";
  return "image/jpeg";
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const services = getServices();
    const release = await services.releases.get(id);
    if (!release) {
      throw new NotFoundError(`Release ${id} not found`);
    }
    if (!release.coverPath) {
      return NextResponse.json({ error: "This release has no cover image" }, { status: 404 });
    }

    // `coverPath` came off the on-disk index, which this route doesn't otherwise trust (see
    // `ReleaseService.assertInsideLibrary`); reading it without the same check would let a
    // tampered entry serve any file on the machine back to the browser. 404, not a distinct
    // error, so a caller can't use this to probe for files outside the library.
    const settings = await services.settings.get();
    const isInside = services.fs.isInside(settings.libraryDir, release.coverPath);
    const isLibraryDirItself = path.resolve(release.coverPath) === path.resolve(settings.libraryDir);
    if (!isInside || isLibraryDirItself) {
      return NextResponse.json({ error: "This release has no cover image" }, { status: 404 });
    }

    let bytes: Buffer;
    try {
      bytes = await services.fs.readFile(release.coverPath);
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
