# What Spotify reports for local files played on the iPhone (issue #103)

Spike, 15 Oct 2026 (00:20–00:33 UTC), part of #102. Run alongside the owner. The scripts were
throwaway and kept outside the repo. The PKCE client used a development-mode app with scopes
`user-read-playback-state user-read-currently-playing user-read-recently-played`. Tokens, account
ids and device ids are left out below.

- Mac: macOS 26.3.1, Spotify 1.3.4.258. Queried with `osascript -l JavaScript`, which reads
  `playerState`, `playerPosition` and `currentTrack` `id`/`name`/`duration`.
- iPhone: Spotify for iOS (version not recorded), named "iPhone" in Spotify Connect.
- Tracks: "l8r dude" (local, Locally-tagged, 128 s), "Stars In The Sky" (local, 141 s) and
  "Bak on ëm" (catalog, 120 s).

## 1. Does the Mac report the phone's playback? (Question 1)

**Yes, as if it were playing on the Mac, with nothing that tells the two apart.** The Mac's
Spotify was open and idle while the phone played.

Local track, phone playing, Mac sampled every 3 s:

```
{"state":"playing","positionSec":70.74,"track":{"id":"spotify:local:Destroy+Lonely:%3C%2F3+%28Unreleased%29:l8r+dude:128","name":"l8r dude","durationMs":128832}}
{"state":"playing","positionSec":1.40, ...same track}   <- the owner restarted the track on the phone
{"state":"playing","positionSec":4.60, ...}
{"state":"playing","positionSec":7.78, ...}
{"state":"playing","positionSec":10.97, ...}
```

Catalog track, phone playing, with the Mac and the Web API sampled side by side:

```
00:31:47  mac playing 10.6 s  spotify:track:6Qvasm9orB6bo3YZ1orw4S | api is_playing 11255 ms is_local false
00:31:52  mac playing 15.7 s                                       | api is_playing 16071 ms
00:32:02  mac paused  22.5 s                                       | api is_playing false 22480 ms   <- paused on the phone
00:32:06  mac playing 25.5 s                                       | api is_playing 26249 ms
```

- `player state`, `player position` and the track id on the Mac follow the phone within about
  1 s, including a pause and a restart.
- The only difference between local and catalog tracks is the id prefix (`spotify:local:` against
  `spotify:track:`). AppleScript has no field for the playing device.
- Consequence: a Mac tracker built as planned counts a play on the phone as a Mac play whenever
  the Mac's Spotify is open. The Mac cannot detect this on its own. Only the Web API's
  `device.type` can.

## 2. Does the Web API report a local file played on the phone? (Question 2)

**Live playback: yes, fully. History: no.**

`GET /me/player` while "l8r dude" played on the phone:

```json
{ "is_playing": true, "progress_ms": 7788, "currently_playing_type": "track",
  "device": { "type": "Smartphone", "name": "iPhone", "is_active": true },
  "item": { "is_local": true,
            "uri": "spotify:local:Destroy+Lonely:%3C%2F3+%28Unreleased%29:l8r+dude:128",
            "name": "l8r dude", "duration_ms": 128000 } }
```

- `GET /me/player/currently-playing` returned the same `item`, `is_playing` and `progress_ms`. It
  has no `device`.
- Polled every 3 s for a minute, `progress_ms` advanced in step: 22690, 25807, 28920 … 75945, then
  2456 after the restart.
- The `uri` is the same `spotify:local:` id the Mac's AppleScript reports, so the matching rules
  in the plan apply unchanged. `duration_ms` is rounded to whole seconds (128000), while the Mac
  reports 128832.
- A second local track ("Stars In The Sky") was reported the same way.
- `GET /me/player/recently-played?limit=10`, called after two full plays of "l8r dude", listed
  only catalog tracks (`is_local: false` for all 10). **Local-file plays never appear in recently
  played**, so a server-side source can't catch up afterwards. It has to sample playback live.

## 3. Spotify's access rules (checked 15 Oct 2026)

- Development Mode: the app owner must have Premium, and the app allows at most **5** users,
  added to an allowlist by hand (changed Feb 2026, effective 9 Mar 2026) [1][2].
- Extended Quota Mode is only for registered organisations with a launched service and at least
  **250k monthly active users** (since 15 May 2025) [2][3]. Locally can't qualify.
- These come from news and third-party write-ups rather than Spotify's own docs. Re-check the
  quota-modes page before building on them.

## 4. Recommendation

- **Phone plays through the Web API are feasible technically but not as a product feature.** The
  data is all there, but the 5-user cap and the organisations-only extended quota limit it to the
  owner plus at most four testers. It also needs a live poller (about every 15–30 s per user),
  because recently-played omits local files.
- **The Mac tracker (#107) goes ahead as the product's source of counts.** Change one thing in the
  plan: show **one total per track, "counted across all your devices"**, not a per-device split.
  With a total, a phone play heard while the Mac's Spotify is open is counted once, by the Mac,
  which is correct. A per-device split would credit it to the Mac, and nothing can detect that
  without the Web API. Phone plays while the Mac's Spotify is closed are missed. The FAQ and
  onboarding should say so.
- **Connect playback guard:** not needed for the total. It would only matter if a second source
  (an opt-in Web API poller) were added later. That poller would skip counting on the Mac whenever
  `/me/player` reports a non-Computer `device.type`.
- **iPhone display (#108, PR #143):** switch to the single total with the "across all your
  devices" line. The API keeps returning per-device data, so no contract change is needed.

## 5. Sources

1. TechCrunch, "Spotify changes developer mode API to require premium accounts, limits test users",
   6 Feb 2026. https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/
2. Vorp Labs, "Spotify API changes 2026: quota, refresh tokens, and the February migration".
   https://vorplabs.com/agent-tools/spotify-api-changes
3. Spotify Community, "Early-stage API access beyond the 5-user limit".
   https://community.spotify.com/forum/en/discussion/7558988/early-stage-api-access-beyond-the-5-user-limit-need-advice
