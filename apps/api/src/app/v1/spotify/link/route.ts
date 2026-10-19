import { NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { parseJsonBody } from "../../../../server/http/validation";
import { withObservability } from "../../../../server/http/observe";
import { NotFoundError, RateLimitError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const linkRequestSchema = z.object({ timeZone: z.string().min(1).max(100) });

const NOT_FOUND = "Not found";

/** Start a link: returns the Spotify authorize URL for this device to open. */
export const POST = withObservability("/v1/spotify/link", async (request, obs) => {
  const services = await getServices();
  if (!services.spotify) throw new NotFoundError(NOT_FOUND);
  const { user } = await requireAuth(request, services.auth, obs);
  const body = await parseJsonBody(request, linkRequestSchema);

  if (!(await services.rateLimiters.spotifyLink.consume(user.id))) {
    throw new RateLimitError("Too many link requests. Try again later.");
  }
  return NextResponse.json(await services.spotify.start(user.id, body.timeZone));
});

export const GET = withObservability("/v1/spotify/link", async (request, obs) => {
  const services = await getServices();
  if (!services.spotify) throw new NotFoundError(NOT_FOUND);
  const { user } = await requireAuth(request, services.auth, obs);
  return NextResponse.json(await services.spotify.status(user.id));
});

export const DELETE = withObservability("/v1/spotify/link", async (request, obs) => {
  const services = await getServices();
  if (!services.spotify) throw new NotFoundError(NOT_FOUND);
  const { user } = await requireAuth(request, services.auth, obs);
  await services.spotify.unlink(user.id);
  return new NextResponse(null, { status: 204 });
});
