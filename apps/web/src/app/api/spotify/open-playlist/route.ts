import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { spotifyAvailable } from "../../../../server/spotify/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A Spotify playlist id is 22 base62 characters. Nothing else reaches `open`. */
const PLAYLIST_ID = /^[A-Za-z0-9]{22}$/;

function runOpen(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("open", args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Open one playlist in the Spotify app (#212). Body `{ id }`. 404 when the connection is off. */
export async function POST(request: Request) {
  if (!spotifyAvailable()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let id: unknown;
  try {
    id = ((await request.json()) as { id?: unknown } | null)?.id;
  } catch {
    return badRequest("Invalid playlist id");
  }
  if (typeof id !== "string" || !PLAYLIST_ID.test(id)) return badRequest("Invalid playlist id");
  try {
    if (process.platform !== "darwin") {
      return NextResponse.json({ error: "Opening Spotify only supported on macOS" }, { status: 400 });
    }
    try {
      await runOpen([`spotify:playlist:${id}`]);
    } catch {
      return NextResponse.json({ error: "Spotify doesn't seem to be installed" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
