import { getServices } from "../../../server/container";
import { withObservability } from "../../../server/http/observe";
import { renderSharePage } from "../../../server/shares/page";
import { limitPublicRequest, notFoundPage, sharePageResponse } from "../../../server/shares/publicResponses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string }>;
}

/** The public share page (#146). The route name is the pattern, so a token is never logged. */
export const GET = withObservability("/s/[token]", async (request, _obs, { params }: Params) => {
  const services = await getServices();
  const { token } = await params;
  await limitPublicRequest(services, request, token);

  const view = await services.shares.publicView(token);
  if (!view) return notFoundPage();
  return sharePageResponse(renderSharePage(view.snapshot, token), view.coverOrigin);
});
