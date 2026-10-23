import type { Services } from "../container";
import { RateLimitError } from "../../shared/errors";
import { clientIp } from "../http/clientIp";
import { hashLinkToken } from "./ShareService";
import { NOT_FOUND_PAGE } from "./page";

/** Headers on every `/s/*` answer: never indexed, never cached, and no Referer (the token is in the URL). */
const BASE_HEADERS = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const PAGE_CSP = (imgSources: string) =>
  `default-src 'none'; img-src ${imgSources}; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/**
 * The 404 page for every unknown, revoked, expired or disabled link, and for a file or zip of one. A constant
 * body, so the bytes cannot differ between the reasons.
 */
export function notFoundPage(): Response {
  return new Response(NOT_FOUND_PAGE, {
    status: 404,
    headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_CSP("'none'") },
  });
}

/** The share page itself. `coverOrigin` is where the cover's signed URL points, allowed in `img-src` for the redirect. */
export function sharePageResponse(html: string, coverOrigin: string | null): Response {
  const imgSources = coverOrigin && coverOrigin !== "null" ? `'self' ${coverOrigin}` : "'self'";
  return new Response(html, {
    headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_CSP(imgSources) },
  });
}

export function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: location } });
}

export function zipResponse(stream: ReadableStream<Uint8Array>, filename: string): Response {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  return new Response(stream, {
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/**
 * Charges the per-IP and per-link allowances for one `/s/*` request, before the link is looked up, so an
 * unknown token costs the caller exactly what a real one does. The link key is the token's sha256, never the token.
 */
export async function limitPublicRequest(services: Services, request: Request, token: string): Promise<void> {
  const message = "Too many requests. Try again later.";
  if (!(await services.rateLimiters.publicShareByIp.consume(clientIp(request)))) throw new RateLimitError(message);
  if (!(await services.rateLimiters.publicShareByLink.consume(hashLinkToken(token)))) throw new RateLimitError(message);
}
