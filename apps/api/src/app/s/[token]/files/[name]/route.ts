import { getServices } from "../../../../../server/container";
import { withObservability } from "../../../../../server/http/observe";
import { limitPublicRequest, notFoundPage, redirectResponse } from "../../../../../server/shares/publicResponses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string; name: string }>;
}

/** 302 to a 5-minute signed URL for the share's cover or one of its tracks. */
export const GET = withObservability("/s/[token]/files/[name]", async (request, _obs, { params }: Params) => {
  const services = await getServices();
  const { token, name } = await params;
  await limitPublicRequest(services, request, token);

  const ticket = await services.shares.publicFile(token, name);
  return ticket ? redirectResponse(ticket.url) : notFoundPage();
});
