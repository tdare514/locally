import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { LocalFileStore } from "../../../../../server/files/LocalFileStore";
import { withObservability } from "../../../../../server/http/observe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ key: string[] }>;
}

/**
 * Dev/test-only stand-in for a direct-to-storage upload: writes the request
 * body to `apps/api/data/files/<key>` once the HMAC signature, expiry, and
 * declared max size from `LocalFileStore.createUpload` check out. Never used
 * in production (`FILE_STORE=blob` swaps in `VercelBlobFileStore`, which
 * needs no route here at all — clients talk to Vercel Blob directly).
 */
export const PUT = withObservability("/v1/internal/local-upload/[...key]", async (request, _obs, { params }: Params) => {
  const services = await getServices();
  if (!(services.fileStore instanceof LocalFileStore)) {
    return NextResponse.json({ error: "Local file storage is not enabled" }, { status: 404 });
  }

  const { key: segments } = await params;
  const key = segments.join("/");
  const url = new URL(request.url);

  const maxBytes = services.fileStore.verifyUploadSignature(
    key,
    url.searchParams.get("exp"),
    url.searchParams.get("max"),
    url.searchParams.get("sig")
  );
  if (maxBytes === null) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }

  await services.fileStore.writeFromRequest(key, request.body, maxBytes);
  return NextResponse.json({ ok: true });
});
