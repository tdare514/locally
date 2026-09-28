import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { toSettingsResponse } from "../../../server/config/settingsView";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { applySyncBaseUrlChange } from "../../../server/sync/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getServices().settings.get();
    return NextResponse.json(toSettingsResponse(settings));
  } catch (err) {
    return errorResponse(err);
  }
}

interface PutSettingsBody {
  libraryDir?: unknown;
  sync?: { baseUrl?: unknown };
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as PutSettingsBody;
    const services = getServices();
    const current = await services.settings.get();

    let libraryDir = current.libraryDir;
    let spotifySourceDismissed = current.spotifySourceDismissed;
    if (body.libraryDir !== undefined) {
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
      // A new folder needs to be added to Spotify again, so the one-time
      // prompt should reappear.
      if (dir !== current.libraryDir) spotifySourceDismissed = false;
      libraryDir = dir;
    }

    let sync = current.sync;
    if (body.sync?.baseUrl !== undefined) {
      if (typeof body.sync.baseUrl !== "string" || body.sync.baseUrl.trim().length === 0) {
        return badRequest("sync.baseUrl must be a non-empty string");
      }
      const result = applySyncBaseUrlChange(current.sync, body.sync.baseUrl);
      if (!result.ok) {
        return badRequest(result.error);
      }
      sync = result.sync;
    }

    if (body.libraryDir === undefined && body.sync?.baseUrl === undefined) {
      return badRequest("Nothing to update: pass libraryDir and/or sync.baseUrl");
    }

    const settings = await services.settings.set({ ...current, libraryDir, sync, spotifySourceDismissed });
    return NextResponse.json(toSettingsResponse(settings));
  } catch (err) {
    return errorResponse(err);
  }
}
