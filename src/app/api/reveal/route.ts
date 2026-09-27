import path from "node:path";
import { execFile } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "../../../lib/settings";
import { badRequest, errorResponse } from "../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (process.platform !== "darwin") {
      return NextResponse.json({ error: "Reveal only supported on macOS" }, { status: 400 });
    }

    let body: { path?: unknown } = {};
    try {
      body = (await request.json()) as { path?: unknown };
    } catch {
      // Empty body is fine; defaults to libraryDir.
    }

    const settings = await readSettings();
    const libraryDir = path.resolve(settings.libraryDir);

    const target = typeof body.path === "string" && body.path.trim().length > 0
      ? path.resolve(body.path)
      : libraryDir;

    const relative = path.relative(libraryDir, target);
    const isInside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (!isInside) {
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
