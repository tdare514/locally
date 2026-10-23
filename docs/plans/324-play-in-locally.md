# #324: play a track inside Locally

## What the owner wants (23 Oct decisions on #324)

- Play a track straight from the file already on the device. There is no copy and no streaming from the service.
- **Where:** a play button on every track row, and a mini player bar while something plays. On the iPhone it
  sits above the tab bar. On the Mac it sits above the release page's bar, and stays across pages.
- **Background:** on the iPhone, playback continues in the background and on the lock screen, with
  lock-screen and Control Center controls.
- **Stats:** a play in Locally counts, into the same counts as Spotify plays.
- **Order (assumed, not asked):** both apps, the iPhone first. The Mac step can run alongside.

## What can play

| Release | iPhone | Mac |
| --- | --- | --- |
| Made or edited in Locally on this device | yes, from the Spotify folder (security-scoped bookmark) | yes, from the library folder |
| Arrived from the other device and sent to Spotify here | yes, it is now in the folder | yes |
| Still waiting in "From your devices" or "From your friends" | no, its files aren't here yet | no |
| Adopted (#245) | no: only its details sync, and the audio is on the Mac | yes, read in place from the Spotify folder it was adopted from (read-only) |
| File moved or deleted outside Locally | no: the row shows "File missing" and is skipped | the same |

A row that can't play shows no play button and gives no reason, except when the file is missing.

## iPhone (apps/ios)

- **Player:** one `PlaybackService`, an `@Observable` app-wide object owning an `AVQueuePlayer`.
  - Playing a row queues that track and the rest of the release, in release order (disc, then track).
  - It opens each file inside `SpotifyFolder.withAccess` and keeps that security-scoped access open while the item plays.
  - Access closes on stop, track change or error.
- **Background:**
  - `UIBackgroundModes: [audio]` in `project.yml`.
  - `AVAudioSession` `.playback`, activated on first play.
  - Interruptions (a call) pause, and resume only when the system says so.
  - A route change to the built-in speaker (headphones out) pauses.
- **Lock screen:** `MPNowPlayingInfoCenter` shows title, artist, album, artwork (the release cover), duration and elapsed time.
  `MPRemoteCommandCenter` handles play, pause, toggle, next, previous and scrubbing.
- **UI:**
  - **Track rows (view mode):** the track number becomes a play button. It's a 44 pt target, with VoiceOver "Play {title}" and "Pause {title}".
    The playing row shows its number as a static now-playing glyph in the accent colour. There is no animated equaliser, so nothing moves under Reduce Motion.
  - **Mini player:** a glass bar above the tab bar, on every tab, shown only while a queue exists.
    It holds the cover, the title, the artist, play/pause and next. Tapping the bar opens the release page.
    A thin progress line runs along its bottom edge.
  - Edit mode, import screens and sheets keep their own layout. The bar sits above the tab bar, not over content: the content insets grow by its height.
- **Counting:** see "Counting a play" below. The phone gets its own plays store for the first time.

## Mac (apps/web)

- **Audio route:** `GET /api/releases/:id/tracks/:trackId/audio` streams the track's file.
  - The path comes from `ReleaseLayout` and is inside-checked against the library folder. An adopted release uses its adopted path, inside-checked against its Spotify folder.
  - It answers `Range` requests (206) so the browser can seek, with `Content-Type` from the extension.
  - It's loopback-only behind the existing Host and origin checks, and `Cache-Control: no-store`.
  - It answers 404 for an unknown release or track, or a missing file. The demo answers 403, like every other demo route.
- **Player:** one `<audio>` element owned by `AppShell`, so playback survives page changes, with a small store holding the queue.
  The `navigator.mediaSession` metadata and action handlers make the Mac's media keys and Now Playing work.
- **UI:**
  - **Track rows:** the number turns into a play button on hover or focus, and the playing row shows the now-playing glyph.
    The keyboard path: Enter or Space on a focused row's play button.
  - **Mini player:** a glass bar above the release bar, in the same glass as the tray and popovers. It holds the cover, title, artist, play/pause,
    next and a scrubber. It shows on every page while a queue exists.
- **Electron:** playback lives in the window. Closing the window stops playback, and the app keeps running in the Dock as now.
  Background playback with the window closed is not part of this plan.

## Counting a play

- **The rule is the Mac's existing one** (`PlayCounter`): a play counts once it has played `min(30 s, 90% of the track)`, once
  per play session. Pausing doesn't restart the session. Replaying from the start after it counted is a new play.
- **Mac:**
  - A Locally play goes through the same `FilePlayCountStore.increment()` as a Spotify play: the all-time count and the day bucket.
  - The existing `pushPlays` sends it as this Mac's device.
  - The Spotify tracker standing down for online counting (#303) doesn't stop Locally plays from counting, because the sampler only sees Spotify.
- **iPhone:**
  - A new `PlayCountStore` holds absolute per-track counts and per-day buckets. Days are the phone's local date, kept 400 days, mirroring
    `plays.json`. It's written atomically in Application Support, keyed by release and track.
  - On reconcile, counts ahead of what was pushed go to `PUT /v1/plays`, at most 500 entries per request. Failures stay pending.
  - Sign-out and account deletion clear only the pushed markers, as the Mac does.
  - The service already accepts any device's counts (`max(stored, sent)` per device and track), so **no API change** is needed.
- **No double count:** a Locally play and a Spotify play of the same file at the same moment would need both apps playing at once.
  - If Spotify is playing when Locally starts, Locally doesn't pause it. Each counts its own.
  - On the Mac, while Locally is playing, the Spotify tracker ignores a now-playing read whose track matches the Locally one.
- **What Stats shows:** the counts include Locally plays, with no split by source. The Stats footnote changes from Spotify-only wording to
  "Plays in Spotify and in Locally".

## Contract and docs

- `spec/sync.md` "Play counts": the iPhone now pushes counts too, and counts include plays in Locally. The wire format is unchanged.
- `docs/design.md`: the row play button, the now-playing glyph and the mini player, for both apps.
- `STATUS.md`: one line per app when each step lands.

## Security and privacy

- Mac route: loopback only. The path is derived, never taken from the request. Inside-checked. No directory listing. No reading outside the
  library and the adopted Spotify folders.
- iPhone: security-scoped access opens per item and is always closed again.
- Nothing new leaves the device except play counts, which already sync.

## Rollout (each an issue with a session brief)

1. **iPhone player:** `PlaybackService`, the row button, the mini player, background audio and the lock screen. No counting.
2. **iPhone counting:** `PlayCountStore`, the counting rule, pushing on reconcile, sign-out handling, and the Stats footnote. Blocked by step 1.
3. **Mac player and counting:** the audio route, the `<audio>` store, the row button, the mini player, media keys, counting into
   `plays.json`, the Spotify-tracker match guard, and the Stats footnote. It can run alongside steps 1 and 2.

Each visible step gets a Codex design review before merge.

## Tests

- **iPhone:**
  - The queue order, including discs.
  - Access opens and closes per item.
  - Interruption and route-change handling (a fake session).
  - Remote commands.
  - The counting rule at 30 s and at 90% of a short track.
  - One count per session.
  - Day buckets.
  - Push batching and pending-on-failure.
  - Sign-out keeps the counts and clears the markers.
  - Rows without a file show no button.
- **Mac:**
  - The audio route: 200, 206 with `Range`, 404 for unknown and missing, refusal outside the library, 403 in the demo.
  - The counting rule through `FilePlayCountStore`.
  - The tracker guard while Locally plays.
  - The mini player's state with keyboard control.
