import path from "node:path";
import { execFile } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { parseRevealBody } from "../../../server/http/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (process.platform !== "darwin") {
      return NextResponse.json({ error: "Reveal only supported on macOS" }, { status: 400 });
    }

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      // Empty body is fine; defaults to libraryDir.
    }
    const body = parseRevealBody(rawBody);

    const services = getServices();
    const settings = await services.settings.get();
    const libraryDir = path.resolve(settings.libraryDir);

    const target = body.path !== undefined ? path.resolve(body.path) : libraryDir;

    if (!services.fs.isInside(libraryDir, target)) {
      return badRequest("path must be inside the library directory");
    }

    await new Promise<void>((resolve, reject) => {
      execFile("open", ["-R", target], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
