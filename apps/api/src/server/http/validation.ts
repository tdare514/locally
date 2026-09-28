import type { z } from "zod";
import { ValidationError } from "../../shared/errors";

/** Hard cap on a request body's size, checked before it's ever parsed as JSON. */
export const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Parse a `Request`'s JSON body against a zod schema, throwing a
 * `ValidationError` (safe message, no zod internals) on any failure —
 * invalid JSON, an oversized body, or a schema mismatch alike. The body size
 * is checked twice: against the declared `content-length` up front (cheap,
 * but a client can lie about it), and again against the actual text read
 * (a `.length` count is a fine approximation of byte size for this purpose).
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ValidationError("Request body too large");
  }

  const text = await request.text();
  if (text.length > MAX_JSON_BODY_BYTES) {
    throw new ValidationError("Request body too large");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    throw new ValidationError(message);
  }
  return result.data;
}

/** Parse a single path/query param against a zod schema (e.g. a UUID route param). */
export function parseParam<S extends z.ZodTypeAny>(value: string, schema: S): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
