import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { parseJsonBody, parseParam } from "../../../../server/http/validation";
import { runAfterResponse } from "../../../../server/http/afterResponse";
import { withObservability } from "../../../../server/http/observe";
import { releaseRecordSchema, uuidSchema } from "../../../../shared/types";
import { ValidationError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export const PUT = withObservability("/v1/releases/[id]", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const { id } = await params;
  const releaseId = parseParam(id, uuidSchema);

  const record = await parseJsonBody(request, releaseRecordSchema);
  if (record.id !== releaseId) {
    throw new ValidationError("Body id must match the release id in the URL");
  }

  const result = await services.releases.upsert(user.id, releaseId, record);

  if (!record.deleted) {
    const keepNames = record.cover ? [...record.tracks.map((t) => t.file), record.cover] : record.tracks.map((t) => t.file);
    const userId = user.id;
    runAfterResponse(async () => {
      try {
        await services.files.pruneUnreferenced(userId, releaseId, keepNames);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "release_prune_failed",
            requestId: obs.requestId,
            userId,
            releaseId,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    });
  }

  return NextResponse.json(result);
});

export const DELETE = withObservability("/v1/releases/[id]", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const { id } = await params;
  const releaseId = parseParam(id, uuidSchema);

  const result = await services.releases.tombstone(user.id, releaseId);
  return NextResponse.json(result);
});
