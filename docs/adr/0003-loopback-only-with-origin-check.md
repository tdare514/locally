# 3. Loopback-only server with an Origin check on mutating requests

## Status

Accepted.

## Context

This server writes to the user's disk (imports files, re-tags tracks in place, deletes releases,
runs `ffmpeg`/`open`) on behalf of whatever sent it an HTTP request. It has no
authentication — it's meant to be a local dev-style tool the user runs and opens in
their own browser, nothing more. That combination (unauthenticated + disk-writing) means
the *network* boundary has to do the job auth would normally do.

Two distinct threats follow from "unauthenticated local server":

1. Another site/tab open in the same browser could try to drive our API (CSRF).
2. A DNS name or another device on the LAN could reach the server if it's not strictly
   bound to loopback semantics (DNS rebinding / accidental exposure).

## Decision

`src/proxy.ts` runs as Next.js middleware on every request and:

- rejects any request whose `Host` header isn't `localhost`/`127.0.0.1`/`[::1]`, so the
  request is only ever "for" the loopback interface regardless of what actually resolved it;
- for mutating `/api/*` methods (`POST`/`PUT`/`PATCH`/`DELETE`), additionally requires the
  `Origin` (falling back to `Referer`) to resolve to a loopback hostname too — this is what
  stops a same-machine-but-different-origin page from issuing a cross-site `fetch()` against
  our API, since browsers always attach `Origin` on cross-site mutating requests;
- sets baseline hardening headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Cache-Control: no-store` on API responses) on every response.

No cookies, sessions, or tokens are involved — the origin/host checks are the entire
trust boundary, by design, for a tool with exactly one intended caller (the page the app
itself serves).

## Consequences

- The app cannot be safely exposed on a LAN or behind a reverse proxy without revisiting
  this decision; `proxy.ts`'s matcher and host allowlist would need to change together
  with a real auth story.
- Any new route added under `src/app/api/` is covered automatically (the middleware
  matcher is `/((?!_next/static|_next/image|favicon.ico).*)`) — there's nothing to opt
  into per-route.
