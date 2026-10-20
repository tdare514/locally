import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { requireAuth } from "../../../../../server/http/authContext";
import { parseJsonBody, parseParam } from "../../../../../server/http/validation";
import { withObservability } from "../../../../../server/http/observe";
import { storedLongNames } from "../../../../../server/releases/storedLongNames";
import { filesUploadRequestSchemaKeeping, uuidSchema } from "../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export const POST = withObservability("/v1/releases/[id]/files", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const { id } = await params;
  const releaseId = parseParam(id, uuidSchema);

  // 404s if the release doesn't exist yet, or belongs to another user.
  const release = await services.releases.getOwned(user.id, releaseId);

  const body = await parseJsonBody(request, filesUploadRequestSchemaKeeping(storedLongNames(release)));
  const uploads = await services.files.createUploads(user.id, releaseId, body.files);
  return NextResponse.json({ uploads });
});
