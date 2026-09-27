import { NextResponse } from "next/server";
import type { ApiError } from "./types";
import { ValidationError, NotFoundError, PublicError } from "./errors";

/** Build a JSON error response, logging the underlying error server-side. */
export function errorResponse(err: unknown): NextResponse<ApiError> {
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  console.error(err);
  if (err instanceof PublicError) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  // Unknown errors may embed filesystem paths or tool output: never echo them.
  return NextResponse.json({ error: "Internal server error. Check the terminal running the app for details." }, { status: 500 });
}

export function badRequest(message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: message }, { status: 400 });
}
