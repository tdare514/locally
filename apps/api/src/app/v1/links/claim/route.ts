import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { withObservability } from "../../../../server/http/observe";
import { parseJsonBody } from "../../../../server/http/validation";
import { RateLimitError } from "../../../../shared/errors";
import { claimLinkRequestSchema } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adds the caller as a recipient of the public share behind a pasted link token. Unknown, revoked, expired and disabled links are one 404. */
export const POST = withObservability("/v1/links/claim", async (request, obs) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  if (!(await services.rateLimiters.linkClaim.consume(user.id))) throw new RateLimitError("Too many link claims. Try again later.");
  const body = await parseJsonBody(request, claimLinkRequestSchema);

  return NextResponse.json({ share: await services.shares.claimLink(user.id, body.token) });
});
