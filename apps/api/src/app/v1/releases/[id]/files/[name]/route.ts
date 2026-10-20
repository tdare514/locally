import { NextResponse } from "next/server";
import { getServices } from "../../../../../../server/container";
import { requireAuth } from "../../../../../../server/http/authContext";
import { parseParam } from "../../../../../../server/http/validation";
import { withObservability } from "../../../../../../server/http/observe";
import { storedLongNames } from "../../../../../../server/releases/storedLongNames";
import { makeFileNameSchema, uuidSchema } from "../../../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string; name: string }>;
}

export const GET = withObservability("/v1/releases/[id]/files/[name]", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const { id, name } = await params;
  const releaseId = parseParam(id, uuidSchema);

  const release = await services.releases.getOwned(user.id, releaseId);
  const fileName = parseParam(name, makeFileNameSchema(storedLongNames(release)));
  const ticket = await services.files.createDownload(user.id, releaseId, fileName);
  return NextResponse.json(ticket);
});
