import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { parseJsonBody } from "../../../../server/http/validation";
import { clientIp } from "../../../../server/http/clientIp";
import { emailRequestSchema } from "../../../../shared/types";
import { RateLimitError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
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
  } catch (err) {
    return errorResponse(err);
  }
}
