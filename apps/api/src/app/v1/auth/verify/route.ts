import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { parseJsonBody } from "../../../../server/http/validation";
import { clientIp } from "../../../../server/http/clientIp";
import { verifyRequestSchema, type VerifyResponse } from "../../../../shared/types";
import { RateLimitError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
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
    const response: VerifyResponse = {
      token: result.token,
      user: result.user,
      device: { id: result.device.id, name: result.device.name },
    };
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}
