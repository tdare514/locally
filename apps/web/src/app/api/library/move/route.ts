import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { homeDir, settingsDir, defaultLibraryDirFor } from "../../../../server/config/paths";
import { NodeFileSystem } from "../../../../server/fs/NodeFileSystem";
import { errorResponse } from "../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../server/demo";
import { LibraryBusyError } from "../../../../server/library/writeActivity";
import { moveLibrary, movableCounts, libraryNotMovableReason } from "../../../../server/library/LibraryMover";
import { BRAND_FOLDER_NAME } from "../../../../shared/brand";
import { ValidationError } from "../../../../shared/errors";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What a move would do: the proposed folder and what moves, for the confirm in Settings (#335). */
export async function GET() {
  if (isDemo()) return demoReadOnly();
  try {
    const { settings, library } = getServices();
    const current = await settings.get();
    const counts = movableCounts(await library.list(current.libraryDir), path.resolve(current.libraryDir));
    const reason = libraryNotMovableReason(
      { fs: new NodeFileSystem(), home: homeDir(), dataDir: settingsDir() },
      current.libraryDir,
      current.adoptRoots ?? []
    );
    return NextResponse.json({
      movable: reason === null,
      ...(reason ? { reason } : {}),
      destination: defaultLibraryDirFor(homeDir(), current.adoptRoots ?? []),
      folderName: BRAND_FOLDER_NAME,
      needsMove: path.basename(current.libraryDir) !== BRAND_FOLDER_NAME,
      ...counts,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Move the library folder to `destination` (#335). Origin is checked by src/proxy.ts. */
export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const body: unknown = await request.json().catch(() => null);
    const destination = body && typeof body === "object" ? (body as { destination?: unknown }).destination : undefined;
    if (typeof destination !== "string") throw new ValidationError("destination must be a path");
    const { settings, library } = getServices();
    const result = await moveLibrary(
      { settings, library, fs: new NodeFileSystem(), home: homeDir(), dataDir: settingsDir() },
      destination
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LibraryBusyError || (err instanceof Error && err.name === "LibraryBusyError")) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
    return errorResponse(err);
  }
}
