import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { requireAuth } from "../../../../server/http/authContext";
import { parseJsonBody, parseParam } from "../../../../server/http/validation";
import { releaseRecordSchema, uuidSchema } from "../../../../shared/types";
import { ValidationError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const services = await getServices();
    const { user } = await requireAuth(request, services.auth);
    const { id } = await params;
    const releaseId = parseParam(id, uuidSchema);

    const record = await parseJsonBody(request, releaseRecordSchema);
    if (record.id !== releaseId) {
      throw new ValidationError("Body id must match the release id in the URL");
    }

    const result = await services.releases.upsert(user.id, releaseId, record);

    if (!record.deleted) {
      const keepNames = record.cover ? [...record.tracks.map((t) => t.file), record.cover] : record.tracks.map((t) => t.file);
      await services.files.pruneUnreferenced(user.id, releaseId, keepNames);
    }

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const services = await getServices();
    const { user } = await requireAuth(request, services.auth);
    const { id } = await params;
    const releaseId = parseParam(id, uuidSchema);

    const result = await services.releases.tombstone(user.id, releaseId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
