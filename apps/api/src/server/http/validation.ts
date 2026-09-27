import type { z } from "zod";
import { ValidationError } from "../../shared/errors";

/**
 * Parse a `Request`'s JSON body against a zod schema, throwing a
 * `ValidationError` (safe message, no zod internals) on any failure —
 * invalid JSON or a schema mismatch alike.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
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
