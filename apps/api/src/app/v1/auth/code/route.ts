import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { parseJsonBody } from "../../../../server/http/validation";
import { clientIp } from "../../../../server/http/clientIp";
import { runAfterResponse } from "../../../../server/http/afterResponse";
import { withObservability } from "../../../../server/http/observe";
import { emailRequestSchema } from "../../../../shared/types";
import { RateLimitError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withObservability("/v1/auth/code", async (request, obs) => {
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

  const code = await services.auth.issueCode(email);
  runAfterResponse(async () => {
    try {
      await services.auth.sendCode(email, code);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "auth_code_send_failed",
          requestId: obs.requestId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });
  return NextResponse.json({ ok: true });
});
