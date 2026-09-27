# iOS companion app plan (repo copy)

Source of truth for discussion is the shared doc "iOS Companion App Plan"; this copy carries what
an implementer needs. Decisions made 27 Sep 2026.

## What it is
A standalone SwiftUI app: import audio, add cover/artist/album/track details, deliver tagged files
into the folder Spotify on iPhone reads local files from. An independent companion, not affiliated
with Spotify, and it says so. Every Spotify limitation is shown as one guided step at the moment it
matters, never hidden.

## Decisions
- Name: Locally. Minimum iOS 17. SwiftUI, SwiftData.
- Assume Spotify Premium; Free-account support explored after launch.
- Conversion: AAC 256 kbps m4a for wav/flac/aiff; mp3 and m4a pass through.
- Edits re-tag the file in place and keep its name, so playlists keep the track.
- Independent from the Mac app for v1; Mac-phone cloud sync is the next phase.
- Pricing (decided 27 Sep 2026): everything built so far is free with unlimited sends. A one-time
  purchase, Locally Full, exists from phase 3 but unlocks nothing yet; features agreed later are
  gated behind it. Paid plans are a later discussion. No network, no analytics, no account: privacy label "Data Not Collected".
- Validation happens on a real phone during phase 1, not as a separate gate.

## Constraints and how each is handled
| Limit | Handling |
| --- | --- |
| No Spotify API for local files | Files on disk only; user makes playlists in Spotify, app pre-names/orders tracks |
| Apps cannot write into another app's storage | User picks Spotify's folder once in the system folder picker; app keeps a security-scoped bookmark |
| Spotify iOS reads mp3/m4a only; iOS has no mp3 encoder | Convert to AAC m4a via AVAssetExportSession |
| Spotify scans its folder itself; on the test phone a new file appeared while Spotify was already open | Done screen says "Open Spotify"; no deep link |
| Spotify caches tags: a new cover shows at once, a new title only after a rescan | Re-tag in place; the after-edit guide says to switch Local Files off and on in Spotify settings |
| No album page for local files | Album = shared cover + album tag + guided "make it a playlist" step |
| App Store brand rules | Own name/icon, no Spotify green, trademark line in About |

## Assumptions to verify on a phone in phase 1
- [x] With Local Files on, a Spotify folder appears under On My iPhone in Files, and a file the app writes there shows in Spotify (confirmed 27 Sep 2026 on an iPhone 14, without restarting Spotify).
- [x] An mp3 tagged by the ID3v2.4 writer shows in Spotify with its artwork and artist (confirmed 27 Sep 2026).
- [x] An m4a (converted from wav on the phone) tagged via AVFoundation shows in Spotify with artwork and artist (confirmed 27 Sep 2026).
- [ ] Local files show and play on a Premium account after reopen.
- [x] A third-party app can pick that folder and later write into it from a stored bookmark (confirmed 27 Sep 2026).
- [x] The share extension delivers a file from another app into Locally and on to Spotify (confirmed 27 Sep 2026 on an iPhone 12 Pro).
- [x] Re-tagging in place works. Spotify picks up a new cover immediately but keeps the old title until Local Files is switched off and on in its settings (confirmed 27 Sep 2026). Files keep their names, so playlists keep the track.

## Architecture
SwiftUI app + Share Extension. One `ReleaseCoordinator` (import, update, delete) calls four
protocol-backed services in order: `FileImporter` (picker, share, reads existing tags),
`Transcoder` (AVAssetExportSession), `TagWriter` (m4a via AVMetadataItem; mp3 via a small ID3v2.4
writer), `LibraryStore` (SwiftData index, same shape as spec/metadata.md). `SpotifyFolder` holds the
security-scoped bookmark; every write starts/stops access. Each service has one production
implementation and one fake for tests.

## Phases
1. Single to Spotify (weeks 1-2): scaffold, onboarding, folder link, one file tagged and sent. Gate: first TestFlight build, a song plays in Spotify.
2. Albums and library (weeks 3-4): album builder, playlist guide, edit in place, delete. Gate: 5 testers, no blockers.
3. Polish and submit (weeks 5-6): share extension, copy pass, one-time purchase (unlocks nothing yet), App Store review.
   App icon decided 27 Sep 2026: the metallic plus (see `docs/design.md`, rendered by `scripts/make-app-icons.py`), with four user-selectable alternates.

## In-app copy (excerpt)
- Welcome: "Add your own songs to Spotify with the cover and details you choose. This app is independent and is not made by or connected to Spotify."
- Turn on Local Files: "To save songs into Spotify, turn on Local Files: open Spotify, tap Settings, then Local Files, then switch it on. Spotify will create a folder for them in your Files app."
- Folder access: "Allow us to move the songs you tag here into that folder. Pick On My iPhone, then Spotify, then tap Open. You only do this once."
- Album explainer: "Spotify can't create albums from your own files, so we'll set these up to become a playlist. They'll share this cover, artist and album name."
- Cover (album): "Pick the cover that'll be applied to all of these tracks."
- Done (single): "Sent. Open Spotify, then Your Library, then Local Files to play it."
- Done (album): "Sent. To hear it as an album, make it a playlist: in Spotify open Local Files, select these tracks, then Add to playlist, New playlist, and name it <album title>."
- After an edit: "Updated. Spotify shows a new cover right away, but keeps the old name until it rescans. In Spotify, open Settings, then Local Files, switch it off and on again, and the new details appear."
- Folder lost: "We can't reach Spotify's folder any more. This happens after Spotify is reinstalled or Local Files is turned off. Tap to reconnect."
- About: "<App name> is an independent app. Spotify is a trademark of Spotify AB. This app is not affiliated with, endorsed by or sponsored by Spotify."
Tone: second person, present tense, one idea per sentence, no exclamation marks; say "Spotify can't" when the limit is Spotify's.
