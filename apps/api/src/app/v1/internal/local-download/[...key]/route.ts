import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { LocalFileStore } from "../../../../../server/files/LocalFileStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ key: string[] }>;
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Dev/test-only counterpart to the local-upload route: see its docstring. */
export async function GET(request: Request, { params }: Params) {
  const services = await getServices();
  if (!(services.fileStore instanceof LocalFileStore)) {
    return NextResponse.json({ error: "Local file storage is not enabled" }, { status: 404 });
  }

  const { key: segments } = await params;
  const key = segments.join("/");
  const url = new URL(request.url);

  const valid = services.fileStore.verifySignature(key, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!valid) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }

  const data = await services.fileStore.readFile(key);
  if (!data) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": contentTypeFor(key) } });
}
