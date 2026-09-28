import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { parseJsonBody } from "../../../../server/http/validation";
import { clientIp } from "../../../../server/http/clientIp";
import { withObservability } from "../../../../server/http/observe";
import { verifyRequestSchema, type VerifyResponse } from "../../../../shared/types";
import { RateLimitError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withObservability("/v1/auth/verify", async (request, obs) => {
  const services = await getServices();
  const body = await parseJsonBody(request, verifyRequestSchema);
  const ip = clientIp(request);

  const [okEmail, okIp] = await Promise.all([
    services.rateLimiters.verifyByEmail.consume(body.email),
    services.rateLimiters.verifyByIp.consume(ip),
  ]);
  if (!okEmail || !okIp) {
    throw new RateLimitError("Too many attempts. Try again later.");
  }

  const result = await services.auth.verify(body);
  obs.setUser(result.user.id);
  const response: VerifyResponse = {
    token: result.token,
    user: result.user,
    device: { id: result.device.id, name: result.device.name },
  };
  return NextResponse.json(response);
});
