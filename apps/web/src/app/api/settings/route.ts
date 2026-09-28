import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { toSettingsResponse } from "../../../server/config/settingsView";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { parseSettingsPutBody } from "../../../server/http/validation";
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

export async function PUT(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const body = parseSettingsPutBody(rawBody);
    const services = getServices();
    const current = await services.settings.get();

    let libraryDir = current.libraryDir;
    let spotifySourceDismissed = current.spotifySourceDismissed;
    if (body.libraryDir !== undefined) {
      let dir = body.libraryDir;
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
