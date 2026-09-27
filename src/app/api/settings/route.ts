import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { badRequest, errorResponse } from "../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getServices().settings.get();
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { libraryDir?: unknown };
    if (typeof body.libraryDir !== "string" || body.libraryDir.trim().length === 0) {
      return badRequest("libraryDir is required and must be a non-empty string");
    }
    let dir = body.libraryDir.trim();
    if (dir === "~" || dir.startsWith("~/")) dir = path.join(os.homedir(), dir.slice(1));
    if (!path.isAbsolute(dir)) {
      return badRequest("libraryDir must be an absolute path (e.g. /Users/you/Music/Spotify Local Import)");
    }
    dir = path.resolve(dir);
    if (dir === path.parse(dir).root || dir === os.homedir()) {
      return badRequest("libraryDir must be a dedicated folder, not your home folder or the filesystem root");
    }
    const settings = await getServices().settings.set({ libraryDir: dir });
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}
