import type { AuthService, AuthContext } from "../auth/AuthService";
import { UnauthorizedError } from "../../shared/errors";
import { parseBearer } from "./bearer";
import type { RequestObs } from "./observe";

/**
 * Authenticate a request's bearer token, throwing 401 if missing or invalid.
 * When `obs` is given, records the authenticated user on it for logging.
 */
export async function requireAuth(request: Request, auth: AuthService, obs?: RequestObs): Promise<AuthContext> {
  const token = parseBearer(request);
  if (!token) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }
  const ctx = await auth.authenticate(token);
  obs?.setUser(ctx.user.id);
  return ctx;
}
