# Playlists from local files (issue #18)

Research, 27 Sep 2026, read-only; brackets point to §6. Two fact-checkers reviewed every
claim.

## 1. Question

Spotify has no album page for local files, so both apps end an album import with guided copy:
open Local Files, select these tracks, Add to playlist, New playlist, name it <album>
(`apps/ios/Locally/Resources/Copy.swift`, `docs/ios-plan.md`). Can Locally create or fill that
playlist instead of asking the user to?

## 2. What is possible today

### Web API: can name the playlist, can't fill it

- Adding a `spotify:local:` URI is rejected: the concepts page says so [1], Add Items takes only
  track and episode URIs [2], staff said "no plans" in 2017 [3][4], the 400 still shows in Dec
  2025 [5].
- Creating works: `POST /me/playlists` with `playlist-modify-private` [6]. Feb 2026 removed
  `POST /users/{id}/playlists` for Development Mode apps [7][8]; the checkers disagreed on the path
  the reference shows (§5).
- Cover works: `PUT /playlists/{id}/images`, scope `ugc-image-upload`, 202 [9]. Body: the bare
  base64 string, `Content-Type: image/jpeg`, not JSON; base64 adds a third, so shrink covers to
  fit 256 KB. Right after create it can 404, so retry [10].
- Reading works: `GET /playlists/{id}/items` flags local entries `is_local: true` with mostly
  empty metadata [11]; since Feb 2026 `/tracks` is `/items` and only the caller's own playlists
  return items [7].
- Reorder by index works [1]. Remove is contested: index plus `snapshot_id` [1] or URIs only
  [12]; `spotify:local:` was rejected on DELETE in 2017 [13], positions ignored in 2024 [14].
- Quota: the Nov 2024 cuts spared playlists [15]. Since May 2025 Extended Quota needs a
  registered business and 250k monthly users; Locally can't qualify [16][17]. Since Feb 2026
  Development Mode allows 5 users per app (was 25) with a Premium owner [8][18][19]; quota is per
  developer account since July [20].

### macOS automation: nothing reaches a playlist

- AppleScript: `Spotify.sdef` has playback commands and a read-only `track` class, no playlist
  class [21], and breaks on updates [22].
- Accessibility UI scripting could drive the menus; it needs a permission, breaks with layout or
  menu-text changes, and falls under the user guidelines' ban on automated means [23].
- Spicetify patches the client, which Developer Terms IV.2.a forbids [24]; Spotify won't
  say it's allowed [25]. No extension adds local files to playlists: the known ones only list or
  link [41][42]; the documented Platform API has no playlist method [43].
- Pasting `spotify:local:{artist}:{album}:{title}:{seconds}` into a desktop playlist worked in
  2015–2017 [3][26]; a 2026 project still relies on it [27]. Unverified on today's client; low
  confidence.

### Local index: no playlists there

`local-files.bnk` (`SPCO` header, protobuf-like records), parsed by psst and Spotifify [28][27],
holds only title, artist, album and path. Playlist membership is a server-side `playlist4` object
[29] that names local tracks by the URI above [30]; membership syncs across devices, playback
doesn't [31]. A local edit likely wouldn't be pushed (inferred, not tested), and writing Spotify's
storage is IV.2.a territory [24]. Out.

### iOS: manual, no shortcut

- The App Remote SDK has no playlist methods; `addItemToLibraryWithURI` saves catalog tracks
  to Liked Songs [32]. Deep links open catalog content [33]. `playlist.new` redirects to
  `open.spotify.com/new/playlist` [34]; untested on iPhone. No Shortcuts or App Intents beyond
  Open App; the idea is Not Right Now [35], and Apple retired SiriKit in June 2026 with no sign
  Spotify followed [36].
- Files reach Spotify only through its folder under On My iPhone [37]; Locally does that.
- The `•••` → Add to playlist item for local files has vanished and returned across releases
  [38]. Multi-select in Local Files is unconfirmed; May 2026's bulk actions are for tracks
  already inside a playlist [39]. Our copy assumes it.

## 3. Options for Locally

Option | Platforms | How it works | ToS risk | Fragility | Effort
--- | --- | --- | --- | --- | ---
A. Status quo | Mac, iOS | Today's copy | None | Low; menu item regresses | 0
B. Guided flow, polished | Mac, iOS | Copy-name button, per-platform steps, fallback line | None | Low | 1–2 days
C. API pre-creates the playlist | Mac, iOS | OAuth PKCE; create playlist named after the album, upload cover; user adds the tracks | Low | Medium: 5-user cap, Premium owner, endpoint churn | 5–8 days
D. Catalog match | Mac, iOS | Search API, fuzzy match, add catalog URIs [40] | None | Medium | 5–8 days; plays Spotify's master, not the file
E. Clipboard `spotify:local:` URIs | Mac | Copy N URIs; user pastes into a new playlist | Low | High: unverified | 1 day plus a manual test
F. UI scripting | Mac | Accessibility drives Spotify's menus | Moderate | Very high | 10+ days, ongoing
G. Spicetify extension | Mac | Patched client calls its internal add | High | High | 5 days; users must patch Spotify
H. Write Spotify's cache | Mac | Edit `local-files.bnk` or LevelDB | High | Very high; yields no membership | Not viable
I. AppleScript or Shortcuts | Mac, iOS | Can only open the app | None | High on Mac | Nothing gained
J. Mac builds, iPhone syncs | Mac, iOS | B on the Mac; the phone fetches the files over the same Wi-Fi, a flow today's support page omits [37] | None | Very high; playback stays per device [31] | 0 beyond B

## 4. Recommendation

**MVP: B.** Typing the name is the one step a third party may skip; a clipboard button does it
without OAuth, network calls, app registration, or a change to the "Data Not Collected" label,
and fixes today's possibly wrong claim of multi-select on both platforms. Effort: 1–2 days, half
of it checking taps on a phone and a Mac.

Mac (Done screen after an album import):
1. Album name with a Copy button; track titles in order.
2. Copy: "Open Spotify, then Your Library, then Local Files. Command-click these N tracks.
   Right-click, Add to playlist, New playlist. Paste the name." Multi-select and the menu item
   are unverified (§5); if absent, use the iPhone steps.
3. Fallback line: "If Add to playlist is missing, update Spotify and open it again."

iPhone (Done screen):
1. Same Copy button.
2. Copy: "Open Spotify, then Your Library, then Local Files. On the first track tap the three
   dots, Add to playlist, New playlist, paste the name. For each other track: three dots, Add to
   playlist, <album>."
3. Same fallback line. If the phone check finds multi-select, shorten step 2.

Keep the Open Spotify wording; a bare `spotify:` URL only foregrounds the app.

**Later: C**, gated. A named playlist with cover saves two taps and a typo on both platforms,
and every call it needs survived the 2024–2026 cuts. The gate is §2's quota: 5 users and a
Premium owner, or a company with 250k users. Build it when Spotify relaxes either, or for a
private Mac build. Effort: 5–8 days (app registration, PKCE via `ASWebAuthenticationSession` on
iOS and a loopback redirect on Mac, tokens, create plus cover with raw-base64 body, compression
and 404 retry, copy, `SECURITY.md`, privacy label). Flow: tap Make it a playlist, sign in once,
Locally creates "<album>" with the cover, then B's steps minus New playlist and the name.

Not D: this app exists for files Spotify doesn't have. Not E yet: an afternoon of testing
decides it (§5).

## 5. Risks and open questions

- Multi-select and Add to playlist for local tracks: unconfirmed on iPhone [38][39],
  unsourced on the Mac (Command-click, context menu); both copies assume them.
- Does pasting `spotify:local:` URIs into a Mac playlist still work? If yes, E removes the
  select step for a day's work [26][27].
- Does `playlist.new` open the iOS app into a New playlist sheet? If yes, B's step 2 shortens [34].
- Re-verify the Create Playlist path (`/me/playlists` vs `/users/{id}/playlists`) on the live
  reference before building C; the two passes disagreed [6][7].
- Remove-by-index vs URI is contested; matters only if Locally edits playlists [1][12][14].
- Local-file playback is per device; elsewhere a playlist lists those tracks greyed out [31].
  Today's support page documents no desktop-to-phone sync, which J needs [37].
- Developer Terms were summarised, not read in full; re-read before quoting [24].
- The Feb 2026 migration targets Development Mode apps; old `/tracks` paths still answer but
  are deprecated [7][8].
- C changes both apps' privacy story; decide before any code.

## 6. Sources

1. https://developer.spotify.com/documentation/web-api/concepts/playlists
2. https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist
3. https://github.com/spotify/web-api/issues/510
4. https://github.com/spotify/web-api/issues/1421
5. https://github.com/spotipy-dev/spotipy/issues/1221
6. https://developer.spotify.com/documentation/web-api/reference/create-playlist
7. https://developer.spotify.com/documentation/web-api/references/changes/february-2026
8. https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
9. https://developer.spotify.com/documentation/web-api/reference/upload-custom-playlist-cover
10. https://stackoverflow.com/questions/78381035/spotify-api-put-playlists-playlist-id-images-returns-404-with-valid-id
11. https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
12. https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist
13. https://github.com/spotify/web-api/issues/612
14. https://github.com/spotipy-dev/spotipy/issues/1098
15. https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
16. https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access
17. https://developer.spotify.com/documentation/web-api/concepts/quota-modes
18. https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security
19. https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/
20. https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates
21. https://github.com/gophergala/teamOFP/blob/master/Spotify.sdef
22. https://community.spotify.com/t5/Desktop-Mac/You-broke-AppleScript-Again/td-p/4937134
23. https://www.spotify.com/us/legal/user-guidelines/
24. https://developer.spotify.com/terms
25. https://community.spotify.com/t5/Spotify-for-Developers/Is-spicetify-bannable/td-p/5826375
26. https://community.spotify.com/t5/Desktop-Windows/Copy-paste-local-tracks-into-playlist/td-p/5377831
27. https://github.com/FYWinds/Spotifify
28. https://github.com/jpochyla/psst/blob/master/psst-gui/src/webapi/local.rs
29. https://github.com/librespot-org/librespot/blob/dev/protocol/proto/playlist4_external.proto
30. https://github.com/librespot-org/librespot/blob/dev/core/src/spotify_uri.rs
31. https://community.spotify.com/t5/Your-Library/Is-it-possible-to-play-local-files-across-multiple-devices/td-p/5521125
32. https://spotify.github.io/ios-sdk/html/Protocols/SPTAppRemoteUserAPI.html
33. https://developer.spotify.com/documentation/ios/tutorials/content-linking
34. https://www.androidpolice.com/2019/10/29/google-opens-up-new-domain-shortcuts-to-other-companies-spotify-medium-bitly-already-on-board/
35. https://community.spotify.com/t5/Live-Ideas/iOS-Siri-Shortcuts-Support/idi-p/4569462
36. https://www.techtimes.com/articles/318005/20260608/wwdc-2026-app-intents-replaces-sirikit-gemini-siri-migration-clock-starts.htm
37. https://support.spotify.com/us/article/local-files/
38. https://community.spotify.com/t5/iOS-iPhone-iPad/Can-no-longer-add-local-files-to-playlists/td-p/5513803
39. https://newsroom.spotify.com/2026-05-28/playlist-folders-mobile-queue-controls-updates/
40. https://github.com/louiefb/integrating-local-music-library-to-spotify
41. https://github.com/Pithaya/spicetify-apps/blob/main/custom-apps/better-local-files/README.md
42. https://github.com/hroland/spicetify-show-local-files
43. https://spicetify.app/docs/development/api-wrapper/methods/platform
