import { NextResponse } from "next/server";
import { errorResponse } from "./responses";
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  UploadTooLargeError,
} from "../../shared/errors";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Per-request observability handle passed to every wrapped route. */
export class RequestObs {
  public userId: string | null = null;

  constructor(public readonly requestId: string) {}

  /** Records the authenticated user for this request, once auth succeeds. */
  setUser(userId: string): void {
    this.userId = userId;
  }
}

/** Injectable log sink so tests can spy on it (via vi.spyOn(console, ...)). */
function log(level: "info" | "warn" | "error", line: Record<string, unknown>): void {
  const payload = JSON.stringify({ level, ...line });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

function requestIdFor(request: Request): string {
  const header = request.headers.get(REQUEST_ID_HEADER);
  if (header && REQUEST_ID_PATTERN.test(header)) return header;
  return crypto.randomUUID();
}

function levelForStatus(status: number): "info" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status === 401 || status === 403 || status === 413 || status === 429) return "warn";
  return "info";
}

/** The error class name for a known, mapped error — omitted from the log line otherwise. */
function errorNameFor(err: unknown): string | undefined {
  if (
    err instanceof ValidationError ||
    err instanceof UnauthorizedError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    err instanceof RateLimitError ||
    err instanceof UploadTooLargeError
  ) {
    return err.constructor.name;
  }
  return undefined;
}

/**
 * Wraps a Next.js route handler with request-id propagation and structured
 * logging: every response carries `x-request-id`; a 4xx/5xx response logs
 * exactly one JSON line with the request id, route, status, duration and
 * user id, never the request body, headers, email, token or code. Successful
 * responses are not logged. Unknown thrown errors are logged once here (as
 * an `error` line) and mapped to the existing generic 500 body.
 */
export function withObservability<Args extends unknown[]>(
  route: string,
  handler: (request: Request, obs: RequestObs, ...rest: Args) => Promise<Response>
): (request: Request, ...rest: Args) => Promise<Response> {
  return async (request: Request, ...rest: Args): Promise<Response> => {
    const requestId = requestIdFor(request);
    const obs = new RequestObs(requestId);
    const method = request.method;
    const start = Date.now();

    let response: Response;
    let thrown: unknown;
    try {
      response = await handler(request, obs, ...rest);
    } catch (err) {
      thrown = err;
      response = errorResponse(err);
    }

    const durationMs = Date.now() - start;
    const headers = new Headers(response.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    response = new NextResponse(response.body, { status: response.status, headers });

    if (response.status >= 400) {
      const line: Record<string, unknown> = {
        requestId,
        route,
        method,
        status: response.status,
        durationMs,
        userId: obs.userId,
      };
      if (response.status >= 500) {
        // Unknown error: log its class and message (no stack) so it's
        // diagnosable, but never leak it in the response body.
        const err = thrown as Error | undefined;
        if (err) line.error = `${err.name}: ${err.message}`;
      } else {
        const knownName = errorNameFor(thrown);
        if (knownName) line.error = knownName;
      }
      log(levelForStatus(response.status), line);
    }

    return response;
  };
}
