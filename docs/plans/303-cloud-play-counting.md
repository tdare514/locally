# #303: count Spotify plays while the Mac is off (a play counter on the sync service)

## Why

Plays are counted only while the Mac app runs and the Mac is awake (#106, #228). On 19 Oct a morning of listening on the phone left the iPhone's Stats at "No plays yet today": the Mac was asleep with its lid shut and Locally started at 10:04.

- The iPhone can't count plays itself (#103).
- Spotify's recently-played never lists local files (`docs/plans/212-spotify-connection.md`, "History"), so a missed play can't be recovered later. Counting has to sample `GET /me/player` live.
- The sync service is the only part of Locally that is always on. This is option B of the #212 plan ("a server poller"), now an owner decision (19 Oct).

## What changes for the owner

- Mac Settings › Spotify gains **Count plays when this Mac is off**. Turning it on opens Spotify's consent page in the browser once.
- From then on the sync service checks what your Spotify account is playing about once a minute, on any device, and counts Locally tracks. The Mac, the iPhone's Stats and the sidebar all show those plays within about two minutes.
- While it is on, the Mac's own tracker steps back, so a play is never counted twice.

## Decisions for the owner

1. **What runs it every minute.** Vercel's Hobby plan runs crons at most once a day ("Hobby accounts are limited to daily cron jobs"), so the sync service can't wake itself every minute. Options:
   - **A. A free external scheduler (recommended now).** A cron-job.org job (or a Cloudflare Worker cron) calls `POST /v1/internal/spotify-sample` every minute with its own secret, `SAMPLER_SECRET`. That secret can only start a sample run, never the daily cleanup.
   - **B. Vercel Pro ($20 a month).** The same route becomes a `* * * * *` entry in `apps/api/vercel.ts`, and it also lifts the 100-deployments-a-day limit noted there. Switching from A to B later is one line plus removing the external job.
   - Not chosen: Vercel Workflow sleeping in a loop (its Hobby allowance is unclear), GitHub Actions schedules (5-minute minimum, often late).
2. **Spotify tokens on the sync server.** This is the first third-party credential the server holds. It is encrypted at rest and limited to one read-only scope (see Security). The owner reviews step 1 before merge.
3. **One counter at a time.** While online counting is on, the server counts every device, including this Mac, and the Mac counts nothing. The other way, where the server counts only while the Mac is asleep, would need the two to hand over cleanly and is not planned.

## Design

### 1. Linking Spotify to the sync service (API)

The server runs its own OAuth grant (PKCE, the same client id as the Mac, no client secret), so the server's tokens never pass through the Mac, and the Mac keeps its own grant for playlists (#212).

- **`POST /v1/spotify/link`** (device token): body `{ timeZone }` (an IANA name, checked with `Intl`). It stores a pending request with:
  - a random 32-byte `state`, stored as its sha256
  - the PKCE verifier
  - the user id
  - a 10-minute expiry

  It returns `{ authorizeUrl }` for `accounts.spotify.com/authorize`, with scope `user-read-playback-state` only and the redirect `https://<sync host>/v1/spotify/callback`. It is rate-limited to 10 an hour per user with `DbRateLimiter`.
- **`GET /v1/spotify/callback`** (browser, no auth):
  - It finds the request by `sha256(state)`, rejects it if it has expired, and deletes it, so a state works only once.
  - It exchanges the code and verifier at `accounts.spotify.com/api/token`, then stores the tokens encrypted.
  - It answers with a small `no-store` HTML page ("Spotify is linked to Locally. You can close this tab.") under `Content-Security-Policy: default-src 'none'`. Errors get a plain sentence with no detail.
- **`GET /v1/spotify/link`** (device token): `{ linked, since, lastSampleAt, problem }`. `problem` is one of `null`, `"reconnect"` (an `invalid_grant`), `"notOnTesterList"` or `"rateLimited"`. Answers 404 when the feature is off.
- **`DELETE /v1/spotify/link`** (device token): deletes the tokens and the session state at once. The cloud device's plays are kept, like a revoked device's. The Mac links to spotify.com/account/apps for removing the grant on Spotify's side, as it does today.
- **Tables** (one migration):
  - `spotify_links`: userId (PK), encrypted refresh and access tokens, access expiry, scope, timeZone, cloudDeviceId, createdAt, lastSampleAt, problem, backoffUntil, and the session state below.
  - `spotify_link_requests`: stateHash (PK), userId, verifier, expiresAt.

  The daily cleanup prunes expired requests. Account deletion removes both in its existing batch.
- **Feature switch:** everything is on only when `SPOTIFY_CLIENT_ID` is set. When it is set, `SPOTIFY_TOKEN_KEY` and `SAMPLER_SECRET` are required in production, with the same refuse-to-start check as `CRON_SECRET` in `env.ts`. When it is unset, every route above answers 404.

### 2. The cloud device

Plays need a device row, because `play_counts` is keyed by (deviceId, trackId).

- Linking creates one `devices` row per user with `platform: "cloud"` and name "Spotify (online)". Its `tokenHash` is the sha256 of 32 random bytes that are thrown away, so it can never sign in.
- Every query over `devices` handles `cloud` explicitly:
  - the per-release plays list shows it under its name
  - device lists and Mac revival by install id skip it
  - idle-device expiry leaves it alone, and its `lastSeenAt` moves on each sample
- **Old clients are safe:** the Mac reads `platform` as `z.string()` (`playsWire.ts:67`) and the iPhone as `String` (`SyncApi.swift:63`).

### 3. The sampler (API)

`POST /v1/internal/spotify-sample` takes `Authorization: Bearer <SAMPLER_SECRET>`, compared with `timingSafeEqual` like `isValidCronBearer`. Each run goes as follows.

1. **A lease.** The run takes a single-row lease for 50 s. A second call inside that window answers 200 with `skipped`. This also stops two runs from refreshing the same rotating refresh token at once.
2. **Every linked user** with no problem and no back-off is sampled at the same time, up to 25 users, with an 8 s timeout per request.
3. **Tokens.**
   - The access token is refreshed when it has less than 60 s left. A rotated refresh token is saved before the new access token is used.
   - `invalid_grant` sets `problem: "reconnect"` and stops sampling that user.
4. **`GET https://api.spotify.com/v1/me/player`:**
   - 204 means idle.
   - 429 sets `backoffUntil` from `Retry-After` (at least 60 s).
   - A 403 "not registered" sets `notOnTesterList`.
5. **Matching and counting** run through the resolver (§4) and the counting rule (§5).
6. **Writes** go in one `db.batch`: the count and day rows for the cloud device (adding 1, the day being the user's local day in `timeZone`) and the new session state.
7. **The reply** is `{ sampled, counted, skipped }` and carries no track names or user ids.

### 4. Matching on the server

The server ports the Mac's `LocalTrackResolver`.

- **Adopted tracks** match on `localId`, the `spotify:local:` id the Mac stored when it adopted the file. It is compared part by part: NFC artist, album and title, and seconds within 2 s.
- **Other tracks** match on the release title, the artist and the track title, with a duration within 2 s. There must be exactly one hit: none, or more than one, does not count.
- **Contract change: an optional `tracks[].localId`** in the release record (`spec/sync.md`, `makeTrackRecordSchema`). It is a string starting `spotify:local:` and at most 1,000 characters, and is sent by the Mac for adopted tracks only.
  - Today the server strips it, and the Mac keeps it locally.
  - Without it, adopted tracks with a "feat." credit or an edited title would miss, and adopted tracks are most of the owner's ~1,567.
- **Reads:** resolve only when the playing uri changes, and keep the result in the session state. A track playing for four minutes reads the library once, not four times.
- **Privacy:** an item that isn't local, or doesn't resolve, clears the session state. The server keeps nothing about tracks outside the user's Locally library.

### 5. Counting at one sample a minute

The Mac samples every 5 s and adds up time listened. The server sees one sample a minute, so it counts on Spotify's `progress_ms` instead.

- **A sample** is (uri, progressMs, durationMs, isPlaying, at).
- **The same session** means the same uri, progress no more than 3 s behind the last sample, and within 10 minutes of it. These are the Mac's resume rules (`PlayCounter.ts`), so a pause and resume is one play.
- **The threshold** is `min(30 s, 0.9 × duration)`, as on the Mac. A session counts once, at the first sample at or past it.
- **A new session** that is first seen already past the threshold counts. That covers a run missed by the scheduler, and a track already playing when online counting was turned on.
- **Known misses**, which Settings will state:
  - a track skipped within about its first minute
  - repeat-one of a track shorter than a minute counts less than it played

  A whole track always counts.

### 6. Mac

- **Settings › Spotify** gains a switch, **Count plays when this Mac is off**. It shows only when signed in to sync, and only when `GET /v1/spotify/link` doesn't answer 404.
  - **On:** `POST /v1/spotify/link` → `shell.openExternal(authorizeUrl)`, only if it starts with `https://accounts.spotify.com/authorize`. Then it polls the link every 2 s for up to 10 minutes.
  - **Off:** `DELETE`.
  - The link status is read on Settings open, and every 5 minutes while the tracker runs.
- **While linked with no problem:**
  - `PlayTracker` stands down, and its status reads "Counted online, even when this Mac is off. Last checked 1 min ago."
  - "Count plays on my other devices" is hidden, because online counting covers it.
- **With a problem:** the Mac's own tracker runs again, and Settings shows the problem with a Reconnect button.
- **Records** include `localId` for adopted tracks. A one-time back-fill re-pushes adopted releases, skipping refused records as #262 does. When a pulled adopted record has lost a `localId` the Mac holds (edited on an older iPhone), the Mac pushes it again.
- **No new visual design.** The switch and its status line use the Settings › Spotify section's existing row components.

### 7. iPhone

- `SyncTrack` gains `localId: String?`. It is carried through edits unchanged and omitted when nil, so an edit on the iPhone keeps the server's copy.
- When Stats is empty, the empty state's line reads "Plays count while your Mac is on, or all the time with Count plays when this Mac is off in the Mac's Settings."

## Contract and compatibility

`spec/sync.md` gains:

- the four `/v1/spotify/link` and callback routes
- the internal sampler route
- `platform: "cloud"`
- `tracks[].localId`

Clients that haven't been updated keep working:

- **Older servers** strip `localId` (zod's default), and clients ignore routes they don't call.
- **An older iPhone** that edits an adopted release drops `localId`. The server then falls back to matching on the details until the Mac re-pushes the record (§6).
- **Plays** reach the iPhone and the sidebar through the existing `GET /v1/plays/summary`, which already sums every device.

## Security

- **Tokens at rest:**
  - AES-256-GCM with a random 12-byte IV, and the user id as associated data, so a ciphertext copied into another user's row fails to decrypt.
  - The key is `SPOTIFY_TOKEN_KEY` (32 bytes, base64, made with `openssl rand -base64 32`). Ciphertexts carry a `v1:` prefix for rotating the key later.
  - Tokens are never logged, never put in an error message or a response, and never sent anywhere but `accounts.spotify.com` and `api.spotify.com`.
- **Least scope:** `user-read-playback-state` only. The Mac's own grant keeps its playlist scopes.
- **OAuth:** PKCE S256, and the state is single-use, expires in 10 minutes and is stored hashed. The authorize URL goes only to the device that asked. The callback page loads nothing and sets `Referrer-Policy: no-referrer`.
- **Sampler:** its own secret, compared in constant time, plus a lease. A leaked `SAMPLER_SECRET` can only make sampling happen early, never twice within 50 s.
- **Data kept:**
  - counts and day buckets under the cloud device (the same data the Mac already pushes)
  - the current Locally track's session state
  - nothing about other listening
- **Paperwork:**
  - SECURITY.md gets a "Spotify tokens on the sync service" section.
  - The owner re-reads Spotify's Developer Terms on server-side token storage before step 5.

## Speed and cost

- **Users:** at most 5 linked users (Spotify's development mode).
- **Each run:**
  - a lease write
  - one read of the links
  - at most 5 `/me/player` calls and the occasional refresh
  - a library read only when a track changes
  - a batch write only when state changed
- **Expected load:** runs should take 1–2 s, about 1,440 a day. That is well inside Hobby's function allowance, and Spotify's rate limits never come close.
- **Check:** the owner looks at the Usage tab 24 hours after step 5.

## Rollout (each an issue with a session brief)

1. **API: linking and tokens** (`spotify_links`, `spotify_link_requests`, the encryption helper, env, the four routes, account deletion, cleanup, `spec/sync.md`, SECURITY.md).
   ```
   Model: sonnet (spec'd here; the owner reviews, new auth)
   Read only: this plan; apps/api/AGENTS.md; apps/api/src/{db/schema.ts, server/config/env.ts, server/account/AccountService.ts, server/cleanup/CleanupService.ts, server/ratelimit/DbRateLimiter.ts, server/http/authContext.ts, app/v1/internal/cleanup/route.ts}; spec/sync.md
   Do not touch: apps/web, apps/ios
   Verify: cd apps/api && npm run check (a fake Spotify token endpoint, no network)
   Done when: link start, callback, status and delete pass their tests, including expired, reused and unknown state and tampered ciphertext; [Owner review] PR
   ```
2. **API: the cloud device and the sampler** (the route, lease, Spotify client, resolver port with the Mac's resolver fixtures, the counting rule, `tracks[].localId` in the schema and spec).
   ```
   Model: sonnet (port of tested Mac code to a written rule)
   Read only: this plan; apps/web/src/server/plays/{LocalTrackResolver,PlayCounter}.ts and their tests; apps/api/src/{server/plays/PlaysService.ts, shared/types.ts, server/auth/AuthService.ts}
   Do not touch: apps/web/src, apps/ios
   Verify: cd apps/api && npm run check
   Done when: sampler tests cover idle, pause and resume, seek back, replay, short track, unmatched item, scheduler gap, refresh and rotation, invalid_grant, 429 and the lease; the resolver agrees with the Mac's fixtures
   ```
3. **Mac: the switch, the link flow, the tracker standing down, `localId` in records and the back-fill.**
   ```
   Model: sonnet
   Read only: this plan; apps/web/AGENTS.md; apps/web/src/server/plays/PlayTracker.ts; apps/web/src/server/spotify/*; apps/web/src/server/sync/SyncEngine.ts (push and pull ranges); the Settings Spotify section
   Do not touch: apps/api, apps/ios
   Verify: cd apps/web && npm run check; a desktop build checked against a local API
   Done when: with the link on, the tracker reports "online" and counts nothing; with a problem it resumes; adopted records carry localId
   ```
4. **iPhone: carry `localId` and the Stats empty-state line.**
   ```
   Model: sonnet (small)
   Read only: this plan; apps/ios/AGENTS.md; apps/ios/Locally/Domain/SyncRecord.swift; apps/ios/Locally/Resources/Copy.swift (Stats)
   Do not touch: apps/api, apps/web
   Verify: xcodegen generate, xcodebuild test (Release config for any install on the owner's phone)
   Done when: a decode-edit-encode round trip keeps localId; StatsCopyTests cover the new line
   ```
5. **Owner, then a live check:**
   - Add the redirect `https://locally-sync-api.vercel.app/v1/spotify/callback` in the Spotify dashboard.
   - Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_TOKEN_KEY` and `SAMPLER_SECRET` in Vercel production.
   - Create the every-minute job (decision 1).
   - Turn the switch on, close the Mac's lid, play a Locally track on the phone for a minute, and see it under Today on the iPhone within two minutes.

Steps 1 → 2 → 3 run in order, and step 4 can run beside step 3.

## Tests

- **No network:** a fake Spotify (token and `/me/player`) in `apps/api/tests/support`, and the existing `testServices`.
- **Linking:**
  - the authorize URL has S256, the state and the single scope
  - the callback handles good, expired, reused and unknown state
  - refresh and rotation are saved before use
  - `invalid_grant` leads to `reconnect`
  - delete removes the tokens, and account deletion removes the link
- **Encryption:** a round trip works; the wrong user id, a flipped byte or the wrong key fails; a missing key in production refuses to start.
- **Sampler:**
  - the samples in §5, each as a table of (uri, progress, playing, at) giving the expected counts
  - day buckets cross local midnight in a non-UTC zone
  - the cloud device can't authenticate
  - a 401 on a bad bearer
  - the lease skips a second run
- **Mac:**
  - the link flow against a fake API
  - `PlayTracker` stands down and resumes
  - the back-fill marks pushed records
- **iPhone:** `localId` survives a decode-edit-encode round trip.
