import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { LocalFileStore } from "../../../../../server/files/LocalFileStore";
import { expectedContentTypeFor } from "../../../../../server/files/contentTypes";
import { withObservability } from "../../../../../server/http/observe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ key: string[] }>;
}

/** Dev/test-only counterpart to the local-upload route: see its docstring. */
export const GET = withObservability("/v1/internal/local-download/[...key]", async (request, _obs, { params }: Params) => {
  const services = await getServices();
  if (!(services.fileStore instanceof LocalFileStore)) {
    return NextResponse.json({ error: "Local file storage is not enabled" }, { status: 404 });
  }

  const { key: segments } = await params;
  const key = segments.join("/");
  const url = new URL(request.url);

  const valid = services.fileStore.verifyDownloadSignature(key, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!valid) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }

  const data = await services.fileStore.readFile(key);
  if (!data) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": expectedContentTypeFor(key) ?? "application/octet-stream" },
  });
});
