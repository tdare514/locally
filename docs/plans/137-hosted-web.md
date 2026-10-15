# #137: a hosted Locally web app (any computer, in a browser)

## Owner decisions (15 Oct, on #137)

- **Accounts:** invite-only beta: the owner plus an invite list (e.g. the 1 Nov testers). Open sign-ups
  wait on #36.
- **Formats:** MP3 only in v1. ffmpeg.wasm conversion comes later, after a licence check against ADR 0006.
- **Delivery:** sync only in v1. The browser uploads a tagged release to the sync API, and the owner's
  Mac and iPhone pull it into the Spotify folder. Direct-to-folder comes later.
- **Domain:** a `locally-*.vercel.app` URL for now.
- **Storage:** the existing quota and the 30-day unused-blob cleanup (#36) apply.

## Shape

A new app, `apps/site` (Next.js on Vercel), with a thin server (backend-for-frontend) in front of the
existing sync API:

1. **Sign in** with the existing email-code flow, restricted to invited emails.
2. **Library:** the same immersive library and release page (#112), reading releases from the sync API.
   Edits push records, and devices re-tag in place on their next reconcile.
3. **Import:** drop MP3s, crop a cover in a canvas, and fill in artist, title, year and genre inline,
   following the "make a record" Import flow the owner picks in #159. The browser writes the ID3 tags,
   then uploads through the existing upload tickets.
4. **Demo:** the existing public read-only demo (#139) stays as the "try it" link. No new demo.

## The compatibility trap (do this first)

Shipped clients parse a release's `origin` as exactly `"mac" | "ios"`:
- `apps/web/src/server/sync/SyncRecord.ts:76` uses `z.enum(["mac","ios"])`.
- The iPhone sends and expects the same values.

A release uploaded from the browser as `origin: "web"` would make the Mac fail its **whole pull page**,
because a bad enum is a structural error, not a skippable record (#39/#60).

So the order is:

1. **Clients become tolerant (Mac and iPhone).**
   - An unknown `origin` is treated as "another device". It shows in the incoming tray and is never
     mistaken for this device.
   - Unknown device platforms in `/v1/me` are shown as a generic device.
   - Ship this, and let the owner's devices update.
2. **Only then** does the API accept `origin: "web"` and `platform: "web"`. Until then the API rejects
   them with 400, so a stray early client can't poison anyone's pulls.

The incoming tray on Mac and iPhone is renamed from "From your phone" / "From your Mac" to
**"From your devices"**, with a small origin label ("from your iPhone", "from the web"). This is
copy only, but it matters once there are three sources.

## Auth in a browser (security-critical)

- Device tokens are bearer tokens and **never reach browser JavaScript**. `apps/site`'s server runs the
  email-code verify and stores the token in an **httpOnly, Secure, SameSite=Strict cookie**, encrypted
  with a server-side key (env, never in the repo). Browser calls go to `apps/site` API routes, which add
  the token server-side.
- **CSRF:** SameSite=Strict, plus an Origin check on every mutating route (the same approach as
  `apps/web`'s proxy).
- **Strict CSP:** no inline script, no third-party origins, plus the Blob upload origin for `connect-src`.
- **Session expiry:** 30 days of inactivity. Sign-out revokes the device server-side.
- **Platform:** the browser registers as a device with `platform: "web"` (after phase 1) and a name like
  "Chrome on MacBook". It appears in the device list and can be revoked from any device.

## Invite-only

- New API table `invites(email, invited_by, created_at, used_at)`. `POST /v1/auth/code` for an email with
  no account succeeds only if the email is invited. The response stays identical either way, so emails
  can't be enumerated.
- The owner manages invites through a small CLI script in `apps/api` (`npm run invite -- add a@b.c`). No
  admin UI in v1.
- Resend's sandbox (#58) only delivers to the owner. **Invites can't receive codes until #58 is done**,
  so this is a hard dependency for testers.

## Import in the browser (MP3 only)

- **Validation:** check extension and MIME, sniff the MP3 frame or ID3 header on the client, and keep the
  server's existing allow-list (#39) and size limits as the real guard.
- **Tagging:** a small, audited ID3v2.4 writer, either written in-repo (about 200 lines against
  `spec/metadata.md`, including TPOS from #113) or an MIT library under 15 KB, vetted in the PR. Tags match
  what the Mac writes, byte for byte where possible, tested against the shared fixtures.
- **Cover:** cropped in a canvas to a square JPEG at 1400 px max. Re-encoding drops EXIF and GPS.
- **Upload:** the existing `POST /v1/releases/:id/files` tickets, then direct-to-Blob PUTs, then
  `PUT /v1/releases/:id` with the record. A partial failure retries only missing files, as on iOS (#27).
- **Big files:** the import is streamed, never fully buffered twice. Speed budget: a 10-track album
  tags in under 1 s on a 2020 laptop.

## Speed budgets

- Library first load: under 150 KB JS gzipped. Covers lazy-load with fixed sizes. Pulls are paged (#30)
  and rendered incrementally.
- Import page: under +40 KB gzipped beyond the library, with the ID3 writer included.
- No WebGL. The motion rules match the Mac app (one motion file, reduced-motion fallbacks).

## Cost

- Uploads count against the existing per-account quota. The 30-day cleanup applies.
- Hosting is a Vercel project on the hobby or free tier while invite-only.

## Rollout (each is an issue with a session brief)

1. **Mac and iPhone tolerance** of an unknown origin and platform, plus the "From your devices" tray copy.
   This ships first.
2. **API:** the invites table and migration, the invite-only code check, and `web` accepted for origin
   and platform, with the cross-user tests. Owner reviews before merge (production migration). Only after
   phase 1 is on the owner's devices.
3. **`apps/site` scaffold:** the BFF auth with the cookie, CSP and CSRF, a read-only library and release
   page, and Vercel project setup. The owner creates the Vercel project and env; the agent doesn't touch
   production settings.
4. **Browser import:** MP3 only, the ID3 writer, the cover crop, upload, following #159's chosen flow.
5. **Edits:** release page edits push records.
6. **Owner tasks:** #58 (email domain) before inviting testers. The invite list for 1 Nov.

## Tests

- Mac and iPhone: a pulled record with `origin: "web"` (or `"future"`) lands in the tray and doesn't fail
  the page. Add shared `spec/fixtures` cases.
- API: invite-only code issuance with identical responses, `web` origin and platform acceptance, the
  migration, and the cross-user matrix for the new device platform.
- Site:
  - The cookie is httpOnly, Secure and SameSite=Strict, and the token never appears in client bundles or
    responses (test it).
  - The CSRF Origin check, the CSP header, and the ID3 writer against the shared fixtures.
  - The import retry after a partial upload.
