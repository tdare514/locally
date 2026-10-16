import path from "node:path";
import { execFile } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { parseRevealBody } from "../../../server/http/validation";
import { demoReadOnly, isDemo } from "../../../server/demo";
import { isReadablePath } from "../../../server/adopt/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
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
      // The one other place Finder may open: the folder of a release added from a Spotify folder (#249).
      // Revealing only selects it in Finder; nothing is read or written.
      const adoptRoots = settings.adoptRoots ?? [];
      const releases = adoptRoots.length > 0 ? await services.library.list(settings.libraryDir) : [];
      const isAdoptedFolder = releases.some((r) => r.adopted === true && path.resolve(r.folderPath) === target);
      // A release stored straight in a Spotify folder has that folder itself as its folderPath.
      const isRoot = adoptRoots.some((r) => path.resolve(r) === target);
      if (!isAdoptedFolder || !(isRoot || isReadablePath(services.fs, libraryDir, adoptRoots, target))) {
        return badRequest("path must be inside the library directory");
      }
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
