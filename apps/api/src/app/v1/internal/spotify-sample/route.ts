import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { withObservability } from "../../../../server/http/observe";
import { isValidCronBearer } from "../../../../server/http/secretBearer";
import { NotFoundError, UnauthorizedError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The every-minute sampler (#303 §3). An external scheduler (cron-job.org) POSTs it with
 * `Authorization: Bearer <SAMPLER_SECRET>`, because Hobby crons run once a day. The secret starts a sample
 * run and nothing else; a 50 s lease stops overlapping runs. Answers 404 when Spotify is not configured.
 * The reply has counts only: no user ids, names or uris.
 */
export const POST = withObservability("/v1/internal/spotify-sample", async (request) => {
  const services = await getServices();
  if (!services.sampler || !services.samplerSecret) throw new NotFoundError("Not found");
  if (!isValidCronBearer(request.headers.get("authorization"), services.samplerSecret)) {
    throw new UnauthorizedError("Invalid or missing sampler secret");
  }
  return NextResponse.json(await services.sampler.run());
});
