# #212: a Spotify connection on the Mac (playlists a track is in, and phone plays)

## Why

Two owner asks need the same new thing, a Spotify account connected to Locally:

- **#212 (15 Oct):** opening a track should "also show what playlists you have it in".
- **#228 (16 Oct):** count plays on the phone too, the way stats.fm counts every device.
  - The iPhone can't count plays itself (#103).
  - stats.fm's route, Spotify's listening history, never lists local files (`docs/research/stream-tracking.md` §2).
  - Spotify's live `GET /me/player` does report a local file playing on the phone.

Locally has no Spotify sign-in today: the `/api/spotify/*` routes only check whether Spotify watches the folder. This plan designs the connection once, then builds the two features on it.

## What Spotify allows (from #18 and #103)

- **Development mode only.**
  - At most **5 users** per app, added by hand to the app's allowlist.
  - The app owner must have Premium.
  - Extended quota needs a registered organisation with 250k+ monthly users, so Locally can't qualify (`docs/research/playlists.md` §2, `stream-tracking.md` §3).
  - So both features are for the owner and up to four testers. Neither is a product feature for every user.
  - Re-check the quota page before building, since these rules came from news and third-party write-ups.
- **Playlists:** `GET /me/playlists` lists them, and `GET /playlists/{id}/items` returns their items.
  - Since Feb 2026 only the caller's own playlists return items, so other people's playlists can't be read.
  - Local files come back flagged `is_local: true`.
- **Live playback:** `GET /me/player` reports each local file with:
  - its `spotify:local:` uri, the same id the Mac's AppleScript tracker already matches
  - `progress_ms`
  - `device.type` (`Smartphone`, `Computer`, and so on)
- **History:** `GET /me/player/recently-played` never lists local files, so nothing can catch up later. Counting has to sample live.

## Decisions for the owner

1. **It's a tester feature.** It ships behind `HAS_SPOTIFY_CONNECTION`, off in builds for everyone else. Settings shows "Connect Spotify" only when it's on. (Recommended.)
2. **The Spotify app.** The owner registers it in the Spotify developer dashboard (Premium) and adds up to four testers. They give the session the client id, which is public: PKCE has no secret.
3. **Where phone plays are counted:**
   - **A. The Mac app samples `/me/player` while it runs (recommended now).**
     - No Spotify token leaves the Mac, and it reuses the tracker.
     - It covers the Mac's waking hours, including when Spotify isn't open on the Mac.
   - **B. A server poller (later, if at all).** This is the only way to count with the Mac off. It needs:
     - Spotify refresh tokens stored on the sync server
     - an always-on worker polling each user every 15–30 s (Vercel functions don't run like that)
     - its own security review
     - the same 5-user cap

     Not planned here.
4. **Playlist names stay on the Mac.** They aren't synced to the iPhone. Showing them on the phone later would put playlist names on the sync server, which is a separate decision.

## Design

### 1. The connection (Mac)

- **Sign-in:** Settings gets a Spotify row with "Connect Spotify".
  - It opens the system browser at Spotify's authorize URL, with PKCE S256 and a random `state`.
  - The code comes back to a loopback redirect, and the app's local server exchanges it.
- **Redirect:** the desktop server runs on a random port each launch (`electron/lib/freePort.ts`), and Spotify matches redirect URIs exactly. Step 1 tries these in order and records what works:
  1. If Spotify accepts any port on `http://127.0.0.1` (RFC 8252 §7.3), redirect to the app's own server: `/api/spotify/auth/callback`.
  2. Otherwise, a one-shot listener on one registered port opens for the sign-in only. The #103 spike used 8888. It closes after one callback or 10 minutes. If the port is busy, the sign-in says so.
  3. Fallback: a `locally://spotify-callback` custom scheme handled by Electron (`setAsDefaultProtocolClient`), which forwards the code to the local server.

  `localhost` isn't allowed; it must be the `127.0.0.1` literal.
- **Scopes, all read-only:**
  - `playlist-read-private` and `playlist-read-collaborative` (#212)
  - `user-read-playback-state` (#228)

  One connection asks for all three. Each feature has its own switch.
- **Tokens:** stored in the config dir settings file, beside the sync device token (`FileSettingsStore`, mode 0600):
  - the access token and its expiry
  - the refresh token
  - the granted scopes
  - the Spotify user id and display name

  Refresh on expiry or a 401, and keep a rotated refresh token when Spotify returns one.
- **Disconnect** deletes the tokens and the playlist cache. Spotify has no revoke call for PKCE tokens, so Settings links to spotify.com/account/apps to remove access fully.
- **Errors:**
  - A 403 "user not registered" says "This Spotify account isn't on Locally's tester list."
  - A 429 waits for `Retry-After`.
  - Offline leaves the last state in place.
- **Local routes** under `src/app/api/spotify/`:
  - `GET connection`: status, display name, scopes
  - `DELETE connection`
  - `POST auth/start`: returns the authorize URL; the server keeps the verifier and state in memory for 10 minutes
  - `GET auth/callback`

  `proxy.ts` already checks Host and the Origin of mutating requests. The callback is a top-level GET from Spotify, so `state` is its CSRF guard: unknown or reused state is refused, and each verifier is used once.

### 2. Playlists a track is in (#212)

- **Read:**
  - `GET /me/playlists` (50 a page) lists the user's playlists.
  - Items are read only for playlists the user owns, or collaborative ones Spotify still returns items for.
  - A playlist's items are read again only when its `snapshot_id` has changed since the last read.
- **Cache:** in the config dir, mapping playlist id → `{ snapshot_id, name, local uris }`. Show the cached answer at once, and refresh in the background when the release page or the Stats page opens and the cache is over 10 minutes old.
- **Match:** a local item's `spotify:local:artist:album:title:seconds` uri goes through the tracker's `LocalTrackResolver`, the same rules that count plays. Step 1 confirms that playlist items carry that uri. If they only carry the name, the fallback is title + artist + album, with duration ±2 s, against Locally's own tags.
- **Show:**
  - On the release page, a track row says "In Night drive and Gym", or "In Night drive, Gym and 3 more", and opens the list.
  - Opening a sleeve on the Stats page shows the same under the track.
  - Nothing shows when the track isn't in a playlist, or Spotify isn't connected.

### 3. Phone plays (#228)

- **`WebApiNowPlaying`** implements the tracker's `SpotifyNowPlaying` interface from `GET /me/player`. It produces:
  - `state`
  - `id` (the `spotify:local:` uri)
  - `positionSec` (from `progress_ms`)
  - `durationMs`

  `PlayTracker` and `PlayCounter` apply the same 30 s / 90 % rule (#106). Plays land in this Mac's counts and day buckets, and are pushed as today.
- **One source at a time.** While connected and "Count plays on my other devices" is on, the Web API sampler replaces AppleScript for every device, this Mac included. That way a play is never counted twice. Any failure of the Web API falls back to AppleScript, which counts this Mac only, as today. These failures count:
  - offline
  - a 401 that can't be refreshed
  - a 403
  - a 429
- **Polling:** every 5 s while something plays and every 30 s when idle (the tracker's own intervals). It stops when disconnected or switched off.
- **Settings says the limits:** counting works while the Mac app runs and the Mac is awake, and phone plays while the Mac sleeps are missed.

## Contract and compatibility

- No sync API or `spec/sync.md` change. Phone plays use the existing `PUT /v1/plays` push, and the one-total display (14 Oct) is unchanged.
- The settings file gains a `spotify` block. An older build ignores it. If an older build rewrites the file, it drops the block, so a downgrade loses the connection, which is fine.
- `HAS_SPOTIFY_CONNECTION` (in `src/components/sidebar/flags.ts` style) gates every Spotify UI and route. When it's off, the routes answer 404.

## Security

- **A new credential:** the Spotify refresh token. It gets the same protection as the sync device token: the config dir file is mode 0600.
  - It is never logged or put in an error message.
  - It is never sent anywhere but `accounts.spotify.com` and `api.spotify.com`.
  - It is never sent to the sync API.
- **OAuth:**
  - PKCE S256 with a random `state` checked on return.
  - The verifier is used once and held in memory only.
  - The callback is on `127.0.0.1` only, and a one-shot listener closes after one use.
  - Read-only scopes; no `playlist-modify`.
- **Data:** playlist names and memberships stay in the config dir. Phone plays are the same data the Mac already counts.
- **Paperwork:**
  - Add a "Spotify connection" section to SECURITY.md.
  - The owner reviews step 1 before merge, since it is new auth.
  - Re-read Spotify's Developer Terms on storing playback data before step 3.

## Speed

- **Playlists:** a refresh is usually one or two `/me/playlists` pages, plus items only for playlists that changed. It runs at most every 10 minutes, and only when a page that shows playlists opens.
- **Phone plays:** one request every 5 s while something plays and every 30 s when idle, per Mac. The #103 spike polled every 3 s for a minute with no limit hit.

## Rollout (each an issue with a session brief)

0. **Owner:** register the Spotify app, add testers, and share the client id. Re-check the quota and redirect rules.
1. **Mac: the connection**, behind the flag:
   - PKCE, tokens, the Settings row, disconnect
   - the redirect choice above
   - a check that playlist items carry the `spotify:local:` uri

   Owner reviews. (New issue.)
2. **Mac: playlists a track is in (#212):** the release page and the Stats sleeve.
3. **Mac: phone plays (#228).**
4. **Later, each an owner decision:** playlists on the iPhone (needs names synced), and a server poller.

## Tests

- **A fake Spotify API in tests, no network:**
  - authorize URL with PKCE and state
  - callback with good, unknown and reused state
  - token refresh and rotation
  - 401, 403 and 429 handling
  - disconnect
- **Playlists:** the `snapshot_id` cache reads only changed playlists, and fixture items match through `LocalTrackResolver` (plus the tag fallback).
- **Phone plays:**
  - `WebApiNowPlaying` samples drive `PlayCounter` to the 30 s / 90 % rule for `Smartphone` and `Computer` devices.
  - Switching sources never counts one play twice.
  - Failure falls back to AppleScript.
