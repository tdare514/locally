import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function runOpen(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("open", args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function POST() {
  try {
    if (process.platform !== "darwin") {
      return NextResponse.json({ error: "Opening Spotify only supported on macOS" }, { status: 400 });
    }

    try {
      // Deep-links straight into Spotify's Settings pane.
      await runOpen(["spotify:preferences"]);
    } catch {
      try {
        // Fall back to just launching the app if the deep link failed
        // (e.g. Spotify wasn't already registered for the URL scheme).
        await runOpen(["-a", "Spotify"]);
      } catch {
        return NextResponse.json({ error: "Spotify doesn't seem to be installed" }, { status: 404 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
