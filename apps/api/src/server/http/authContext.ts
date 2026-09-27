import type { AuthService, AuthContext } from "../auth/AuthService";
import { UnauthorizedError } from "../../shared/errors";
import { parseBearer } from "./bearer";

/** Authenticate a request's bearer token, throwing 401 if missing or invalid. */
export async function requireAuth(request: Request, auth: AuthService): Promise<AuthContext> {
  const token = parseBearer(request);
  if (!token) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }
  return auth.authenticate(token);
}
