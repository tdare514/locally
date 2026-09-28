/**
 * Error classes shared between services and route handlers. Each message is
 * safe to send straight back to the client; anything that might embed
 * internal detail (stack traces, driver errors) must never be wrapped in one
 * of these and is instead logged server-side and replaced with a generic
 * message by `server/http/responses.ts`.
 */

/** The request body/query failed validation (maps to HTTP 400). */
export class ValidationError extends Error {}

/** Missing or invalid bearer token, wrong auth code, revoked device (maps to HTTP 401). */
export class UnauthorizedError extends Error {}

/** The resource doesn't exist, or exists but belongs to another user (maps to HTTP 404). */
export class NotFoundError extends Error {}

/** A write lost a last-writer-wins race (maps to HTTP 409). */
export class ConflictError extends Error {}

/** Sliding-window rate limit exceeded (maps to HTTP 429). */
export class RateLimitError extends Error {}

/** An upload exceeded the size declared when its signed URL was issued (maps to HTTP 413). */
export class UploadTooLargeError extends Error {}
