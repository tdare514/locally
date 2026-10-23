import { getServices } from "../../../../server/container";
import { withObservability } from "../../../../server/http/observe";
import { limitPublicRequest, notFoundPage, zipResponse } from "../../../../server/shares/publicResponses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A large release streams for a while; the archive is built on the fly and never stored.
export const maxDuration = 300;

interface Params {
  params: Promise<{ token: string }>;
}

export const GET = withObservability("/s/[token]/zip", async (request, _obs, { params }: Params) => {
  const services = await getServices();
  const { token } = await params;
  await limitPublicRequest(services, request, token);

  const zip = await services.shares.publicZip(token);
  return zip ? zipResponse(zip.stream, zip.filename) : notFoundPage();
});
