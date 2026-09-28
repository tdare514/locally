import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { parseJsonBody } from "../../../../server/http/validation";
import { clientIp } from "../../../../server/http/clientIp";
import { withObservability } from "../../../../server/http/observe";
import { emailRequestSchema } from "../../../../shared/types";
import { RateLimitError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withObservability("/v1/auth/code", async (request) => {
  const services = await getServices();
  const { email } = await parseJsonBody(request, emailRequestSchema);
  const ip = clientIp(request);

  const [okEmail, okIp] = await Promise.all([
    services.rateLimiters.codeByEmail.consume(email),
    services.rateLimiters.codeByIp.consume(ip),
  ]);
  if (!okEmail || !okIp) {
    throw new RateLimitError("Too many code requests. Try again later.");
  }

  await services.auth.issueCode(email);
  return NextResponse.json({ ok: true });
});
