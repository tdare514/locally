import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../../../../server/container";
import { errorResponse } from "../../../../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../../../../server/demo";
import { parseByteRange, resolveTrackAudio, streamFile } from "../../../../../../../server/releases/TrackAudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string; trackId: string }>;
}

/**
 * Streams one track's file to Locally's own player (#338). Loopback only (src/proxy.ts), and the file is the one
 * the release record names, checked inside the library (see `resolveTrackAudio`); nothing of the request but
 * the two ids and the Range header is used. Answers Range requests so the player can seek.
 */
export async function GET(request: NextRequest, { params }: Params) {
  // The demo has no files; it refuses like every other demo route.
  if (isDemo()) return demoReadOnly();
  try {
    const { id, trackId } = await params;
    const { settings, library, layout } = getServices();
    const current = await settings.get();
    const release = await library.find(current.libraryDir, id);
    const file = await resolveTrackAudio(layout, current.libraryDir, current.adoptRoots ?? [], release, trackId);

    const headers: Record<string, string> = {
      "Content-Type": file.contentType,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    };
    const range = parseByteRange(request.headers.get("range"), file.size);
    if (range === "invalid") {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
    }
    if (range === null) {
      return new NextResponse(streamFile(file.realPath, null), {
        status: 200,
        headers: { ...headers, "Content-Length": String(file.size) },
      });
    }
    return new NextResponse(streamFile(file.realPath, range), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
