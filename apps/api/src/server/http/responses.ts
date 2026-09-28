import { NextResponse } from "next/server";
import type { ApiError } from "../../shared/types";
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  UploadTooLargeError,
} from "../../shared/errors";

function json(status: number, error: string): NextResponse<ApiError> {
  return NextResponse.json({ error }, { status });
}

/**
 * Map a thrown error to a JSON error response, never leaking stack traces or
 * internal detail. Every known error class carries a message that's already
 * safe to show the client; anything else is logged server-side and replaced
 * with a generic message.
 */
export function errorResponse(err: unknown): NextResponse<ApiError> {
  if (err instanceof ValidationError) return json(400, err.message);
  if (err instanceof UnauthorizedError) return json(401, err.message);
  if (err instanceof NotFoundError) return json(404, err.message);
  if (err instanceof ConflictError) return json(409, err.message);
  if (err instanceof RateLimitError) return json(429, err.message);
  if (err instanceof UploadTooLargeError) return json(413, err.message);
  return json(500, "Internal server error");
}
