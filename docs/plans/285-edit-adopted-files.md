# #285: edit adopted files in place on the Mac, with one clear review page (and the artist rename)

## Why

The owner, 16 Oct: people should be able to fix the files adopted from the Mac's Spotify folders (#245), "that's the whole point". A file that arrives untagged can't be fixed while adopted releases are read-only. #245 made them read-only for v1, because an edit changes Spotify's id for the file, and left "editing with a playlist warning" for later. This is that step.

The same review page also covers renaming an artist everywhere (#224, decision 3), and the owner's follow-up (comment, 16 Oct): a setting to also rename the file to match its tags.

These are files Locally didn't create, often the only copy the owner has. So the bar is: no edit can ever leave a file damaged or half-written, and every edit can be undone.

## What is true today

- **Adopted releases** (`adopted: true`, `apps/web/src/shared/types.ts`) live in the folders listed in `settings.adoptRoots`. Formats: mp3, m4a and audio-only mp4 (#245 decision 3).
- **The guard:** `assertWritable(release)` (`apps/web/src/server/adopt/guards.ts`) refuses every write path for an adopted release: `ReleaseService` (re-tag, cover, delete files, accept, Send) and `SyncEngine`. Reads are allowed inside `adoptRoots` after realpath (`isReadablePath`), so a symlink pointing out of a root is refused.
- **The re-tag path flattens a release.** `ReleaseService` (~224) writes the release's artist (also as album artist), title (as album), year, genre and cover to every track. That suits Locally's own releases. It would wipe the per-track differences an adopted folder may have, such as a compilation's track artists.
- **Clearing a tag doesn't work.** `Id3TagService` (~30) writes year and genre only when they're set, so a null leaves the old value in the file.
- **Tag writing on the Mac** is ID3 only (node-id3). Locally's own library is all mp3 (non-mp3 imports are converted), so there is no m4a writer.
- **Spotify's id** for a local file is `spotify:local:<artist>:<album>:<title>:<seconds>` (`adopt/localId.ts`). It is built from the tags, not the file name.
  - Plays match an adopted track by its stored `localId` first. `LocalTrackResolver.resolveAdopted` (~60) returns the first adopted track that matches.
  - The tag fallback (~80) uses release-level metadata and also covers adopted tracks.
- **Playlists:** `PlaylistIndex.forRelease(releaseId)` (#212) says which playlists hold each track. When its cache is stale it starts a refresh in the background and answers from what it has, which can be nothing yet (~130).
- **Sync file names follow the file on the Mac.** `SyncRecord.ts` (~194) sets `tracks[].file` to `basename(filePath)`. `SyncEngine` (~258) uploads any record file name the server doesn't hold yet.
  - `spec/sync.md` says `tracks[].file` "names the stored object; the name never changes after upload".
  - For an adopted release, `tracks[].file` is just the file's own name, and no track is uploaded.
  - The iPhone applies a remote update to a release it already has as details only: no files are re-downloaded or renamed (`SyncEngine.swift`, `applyRemoteUpdate`).
- **Review pages today:**
  - The iPhone's "Check your changes" (#220): old value struck through above the new one.
  - The Mac's adopt review (`AdoptReviewView`).
  - The Mac's bulk edit has no review.

## Decisions for the owner

1. **Which warnings "Ignore for this session" can skip (recommended).** The swipe hides, until Locally quits, the review page for a plain tag edit of up to 20 adopted files. It never skips:
   - a rename of any file
   - the library-wide artist rename
   - an edit of more than 20 files
   - the first edit of a file that is in a Spotify playlist
   - any edit while Locally doesn't yet know which playlists hold the files (still checking, stale, or failed; see "Playlists")
2. **Name pattern for renamed adopted files (recommended: keep the folder's style).** Locally reads the file's current name against a few known patterns, built from its current tags: "03 Title", "03 - Title", "Artist - Title", "Title". When one matches, the new name uses the same pattern with the new tags. When none matches, the file keeps its name and the review says so ("Keeps its name: Locally can't tell how it's named"). The alternative is always Locally's "03 - Title", which renames files the user may have named on purpose.
3. **What a rename of Locally's own files does to sync.** The Mac names each synced file after its own file, so a rename can't simply stay on the Mac. There are two choices:
   - **(a) The synced name follows the rename, as the owner's comment asks.** The Mac uploads each renamed file again under its new name, and the server drops the old one. An artist rename across 40 tracks is about 40 full uploads. The iPhone keeps its own copies under their old names, because it never re-downloads a release it already has. This is a change to `spec/sync.md` ("the name never changes after upload").
   - **(b) The synced name stays (recommended).** Each track remembers the name it was uploaded under (a new `syncFile`, set at its first rename), and the record keeps using it. Nothing uploads again and `spec/sync.md` holds. The cost is that the Mac's file name and the stored name differ, which only Locally ever sees.

   Both keep the iPhone's file names as they are. Adopted releases upload no tracks, so their record's `file` simply follows the new name either way.
4. **Spotify first (owner, before step 3 merges).** On one adopted track that sits in a playlist, then restart Spotify each time:
   - Change the artist tag only, and see whether the playlist keeps it.
   - Rename the file only (same tags), and see again.

   Spotify's id is built from the tags and has no file name in it. So the expectation is that the tag change can drop the track and the rename alone doesn't. The warnings' wording and the setting's lines are final only after this test.
5. **The reference screenshot.** The owner is sending a screenshot of the current review page, as the example of what isn't clear enough. Step 3's design starts from it.

## Design

### What can be edited (Mac only)
- **Fields:** title, artist, featuring (#224, written into the title), album, album artist, year, genre, track and disc numbers with their totals, and the cover.
- **What Locally never does to an adopted file:** move it to another folder, delete it, or add other files to the chosen folders. Renames happen only through the setting below, inside the file's own folder.

### Patch, don't flatten
- **An adopted edit is a per-file patch.** Only the fields the user changed are written. Every other tag keeps each file's own value, so a compilation keeps its per-track artists.
- **The adopted path is new, beside `ReleaseService`'s re-tag.** It doesn't go through the release-level writer, which stays as it is for Locally's own releases.
- **Clearing is explicit.** A field set to "none" removes that tag. The writers must support it (the ID3 writer must stop leaving year and genre behind on a null). It is tested for every field.

### Every adopted write, step by step
1. **At review,** record each file's identity:
   - its realpath, device and inode
   - its size and modified time in nanoseconds
   - a SHA-256 of its bytes
   - it must be a regular file with one link (lstat, not a symlink, link count 1; hard-linked files are refused for now)
2. **One at a time.** Adopted writes go through one queue on the server, so two saves can't race on the same file.
3. **Same volume only.** The work copy lives in `<app data>/adopted-work/`. Locally refuses a file on a different volume from its data folder (different device id). The message reads: "Locally can only edit files on the same disk as its data for now."
   - This is so the final swap is always an atomic rename. Locally never copies over a live file.
   - The owner's folders are on the Mac's main disk.
4. **Copy.** The copy keeps the file's mode, extended attributes (such as Finder tags) and dates.
5. **Write the tags to the copy.**
6. **Verify the copy:**
   - It parses.
   - The changed tags read back as the new values, and every other tag and atom is identical to the original's.
   - The audio payload is byte-identical (the mp3 frames after the tag, or the mp4 `mdat` and the sample tables it points to).
   - The duration is unchanged.
7. **Journal.** Write the intent (release, track, new tags, new `localId`) to `<app data>/adopted-work/journal.json` with fsync.
8. **Check again, then swap.** Immediately before the rename, re-check the original's identity from step 1: device, inode, size, modified time and the SHA-256. Re-check its realpath containment too. Any difference means the file changed since review: the copy is dropped and the page shows the review again with fresh tags. Then rename the copy over the original.
9. **Update the library.** Update `library.json` (the track's tags and `localId`), then clear the journal entry.
- **If Locally stops at any step,** the original is untouched until the rename, and the rename is atomic. At the next launch Locally reads the journal:
  - A file whose tags are already the new ones gets its `library.json` update finished.
  - Anything else is dropped.
  - Leftover work copies are deleted.

### The writers
- **mp3:** node-id3 on the copy. It keeps the frames it doesn't own. Explicit removal is added for cleared fields.
- **m4a and mp4: a new `Mp4TagEditor` that preserves the file.** ffmpeg can't be used to write: its muxer rebuilds the metadata from the keys it knows and drops freeform `----` atoms such as `iTunSMPB` (gapless).
  - The editor parses the box tree.
  - It rewrites only the changed `ilst` items, and keeps every other box byte for byte.
  - When the metadata grows, it uses an existing `free` box where there is room. Otherwise it rebuilds `moov` and shifts every `stco`/`co64` chunk offset when `moov` comes before `mdat`.
  - It refuses what it can't parse or doesn't support: fragmented mp4, more than one audio track, a broken box tree. The review then says "This file can't be edited yet".
  - The verify step parses the result again and compares box by box.

### Undo: "Restore original tags"
- **Before the first edit** of an adopted file, Locally saves everything any writer could change. It goes in `<app data>/adopted-originals/<release id>/<track id>.json` (0600):
  - every editable field's value, or an explicit "absent"
  - the embedded artwork's bytes (as `<track id>.cover`), or "no artwork", taken even when the first edit doesn't touch the cover, so a later cover edit can still be undone
  - the original file name
  - the original `localId`
- **Later edits** never overwrite it.
- **"Restore original tags"** (on the release page, for an adopted release with a snapshot) goes through the same review and the same write steps. It restores each field, or removes it where it was absent. It puts the artwork back, or removes it, and renames the file back; a name that is now taken gets " (2)". Afterwards it deletes the snapshot.
- **"Remove from Locally"** deletes the snapshot too.

### Plays keep matching
- **After a write,** the track's `localId` is rebuilt from the new tags (`buildLocalId`). Every earlier id it had stays in `localIdAliases`.
- **An alias is retired** once Spotify has reported the track's current id at least once (proof it re-read the file). An alias is never dropped just for being old.
- **No guessing.** `resolveAdopted` collects every track whose current id or alias matches. When more than one distinct track matches, the result is "ambiguous", and no play is counted (today it returns the first match).
- **The tag fallback skips adopted tracks,** which always have ids. The fallback stays for Locally's own releases.

### Playlists
- **Three states** for the review: **known** (from a fresh index), **unknown** (still checking, stale, the refresh failed, or Spotify not connected), and **none**.
- **Unknown is never treated as "in no playlists".** The review says "Locally is still checking your Spotify playlists" or "Locally can't see your playlists", and "Ignore for this session" can't skip it.
- **The page waits up to 10 seconds** for a refresh it started, then shows the unknown state with a Check again button.

### The review page (one page for every edit that reaches into files Locally didn't add)
- **Used for** any save that writes an adopted file, any rename, the artist rename, and Restore. A save of Locally's own files without a rename keeps today's direct save.
- **Content, in plain words, top to bottom:**
  - **What changes:** each field as before → after (old value struck through above the new one, as on #220). A rename shows the old file name struck through above the new one.
  - **The summary:** "Changes 12 files. 9 of them came from your Spotify folders." Renames are counted on their own: "Renames 4 files."
  - **Playlists:** known: "In 3 of your Spotify playlists: Night drive, Gym, Sunday. Spotify may drop these tracks from them until you add them again." Unknown: as above. The wording follows decision 4's test.
  - **Restart:** "Spotify shows the new details after you restart it."
  - **Undo:** "You can restore the original tags from the release page."
  - **Actions:** Save (primary), Cancel, and **Ignore for this session** as a slide-to-confirm track, only where decision 1 allows it.
- **The result.** After saving, the page lists what failed, by file, with the reason ("changed since you reviewed it", "on another disk", "can't be edited yet"). The rest are saved.
- **Tone:** clear without being alarming. One warning colour, used only for the playlist line. No all-caps labels.
- **The design entry** for the page goes in `docs/design.md` first, as #245 did.

### Setting: "When you edit a track" (Settings › Files)
The lines are drafts until decision 4's test.
- **Change the tags only** (the default). Picture: "03 Midnight.mp3" keeps its name and only the tag card changes. Line: "The file keeps its name. A new title, artist or album can still make Spotify treat it as a new track; the review shows which playlists hold it."
- **Also rename the file to match.** Picture: "03 Midnight.mp3" becomes "03 Midnight (feat. B).mp3". Line: "The file's name follows its tags, so it reads the same in Finder."
- **Scope:**
  - The setting applies on the Mac, to Locally's own library and to adopted files.
  - The iPhone keeps never renaming (its AGENTS rule) and keeps adopted releases read-only.
- **The rename itself:**
  - The new name keeps the extension and stays in the file's folder.
  - It is sanitised by `ReleaseLayout` (#85 rules, the #87 byte limit) and inside-checked against the library or the adopt root.
  - A name that is taken gets " (2)".
  - It runs after the tag swap succeeds, and it is journalled the same way.
  - If the rename fails, the tags stay written and the result says so.
- **The pattern:**
  - Locally's library keeps "03 - Title.mp3" (`ReleaseLayout.trackFileName`), with the title in its "Song (feat. B)" form.
  - Adopted files follow decision 2.
- **Sync:** decision 3.

### Renaming an artist everywhere (#224, decision 3)
- **Where:** a "Rename artist…" action on the artist page (#288). It takes a new spelling, with suggestions and "Did you mean" from #287.
- **What it touches:** every release whose main artist has that key, and every track that features it (the name inside "(feat. …)"). That covers Locally's own files and adopted ones alike.
- **How each file is written:** adopted files go through the patch and write steps above. Locally's own releases use the existing re-tag. The rename setting applies to both.
- **The review page** groups the changes by release.
- **Merging:** renaming to an existing artist's spelling merges the two. The review says so: "The Weeknd already has 12 tracks. These 3 join them."
- **Progress:** it runs one release at a time through the queue, with a progress line, and can be stopped between releases. Each finished release is complete and consistent. The result lists what failed, by title.

## Contract and compatibility

- **Sync:**
  - Details sync as today. An edited adopted release pushes its new details with `source: "adopted"`, and its `tracks[].file` follows a rename.
  - Locally's own releases follow decision 3: (a) changes `spec/sync.md`; (b) adds the Mac-only `syncFile` and keeps the spec.
  - There is no API change either way.
- **`spec/metadata.md`:** the `filePath` row changes from "never renamed on edit" to "renamed on edit only when the user turns on Also rename the file (Mac)".
- **iPhone:** it shows the new details. Adopted releases stay read-only there.
- **Older Mac builds:** they ignore `localIdAliases`, `syncFile`, the journal and the snapshot files.

## Security and safety

- **Every adopted write** follows the steps above: identity recorded at review, one queue, same volume, verify, journal, re-check, atomic rename. The only writes inside a chosen folder are that rename and the optional file rename.
- **Every path** is inside-checked after realpath, and must be a regular file with one link.
- **No shell strings.** ffmpeg (used only to read durations for verify, if needed) gets an argument array.
- **Temporary files, backups, the journal and snapshots** live in Locally's data, 0600.
- **`SECURITY.md`** gets a paragraph on writing adopted files (step 2).
- **Tests** use temp dirs and generated fixtures, never the owner's folders.

## Tests

- **Writers (mp3 and m4a, generated in temp dirs, as `Id3TagService.test.ts` does):**
  - Each field changes, and clearing removes it.
  - Every other frame or box survives byte for byte, including a freeform `----:com.apple.iTunes:iTunSMPB`.
  - The audio payload is identical.
  - m4a with `moov` before `mdat` keeps correct chunk offsets when the metadata grows.
  - Fragmented and unparseable files are refused.
- **The write steps:**
  - A failed verify leaves the original untouched.
  - A crash after the journal and before the rename, and after the rename before `library.json`, both recover at the next launch.
  - A file changed between review and commit (same size and modified time, new content) is refused.
  - A different volume, a symlink, a hard link and a path outside the roots are each refused.
  - Mode and extended attributes are kept.
- **Patching:** a three-track folder with different track artists keeps them after an album-only edit.
- **The snapshot:**
  - It is written once, with the artwork even when the first edit doesn't touch the cover.
  - Restore brings back every field, absent fields included, plus the artwork and the name.
  - "Remove from Locally" deletes it.
- **Plays:**
  - Several edits in a row keep every alias until Spotify reports the current id.
  - An alias shared by two tracks gives "ambiguous" and no count.
  - Restore keeps matching.
  - Adopted tracks never match through the tag fallback.
- **Playlists:** known, unknown (still checking, stale, failed, not connected) and none, and "Ignore for this session" is refused while unknown.
- **The rename:**
  - Each pattern of decision 2 is detected, and an unknown pattern keeps the name.
  - Collisions get " (2)". The #85 and #87 fixtures pass, and the extension is never changed.
  - Sync per decision 3: the record's names, and whether a push uploads.
- **The review model:** the counts (files, not added by Locally, renames), and which warnings "Ignore for this session" skips.
- **The artist rename:** the plan of changes across own, adopted and featured tracks, the merge message, and a stop part-way through.
- **UI:**
  - Screenshots: the review page (a small edit, a rename, the artist rename, playlists unknown), the setting, and Restore.
  - The slide-to-confirm works with the keyboard and has VoiceOver labels.

## Rollout (each an issue with a session brief)

0. **Owner:** decisions 1 to 3, the Spotify test (decision 4), and the reference screenshot (decision 5).
1. **The writers.** The mp3 writer's clearing, and the new `Mp4TagEditor`. Server only.
2. **The adopted write path:**
   - the patch model and the guard change
   - identity, the queue, verify, the journal and recovery
   - the snapshot and Restore
   - `localIdAliases` and the resolver change
   - the playlist states
   - the routes

   It stays behind `ADOPTED_EDITS_ENABLED`: a server-side flag, off by default, that every adopted-write route checks. Delete, accept and Send keep their own guard, `assertWritable`, unchanged.
3. **The review page** and editing adopted releases in the UI. The flag turns on when this merges. Codex reviews the design.
4. **The rename setting** and file renames (own and adopted), with decision 3's sync behaviour.
5. **Rename an artist everywhere** from the artist page. It needs #288.

Session briefs:

```
Step 1 — Model: sonnet (spec'd server code with generated fixtures)
Read only: this plan (Design: The writers, Every adopted write; Tests: Writers), apps/web/AGENTS.md, apps/web/src/server/audio/TagService.ts, Id3TagService.ts, apps/web/tests/unit/Id3TagService.test.ts (how fixtures are made in temp dirs), apps/web/src/server/fs/FileSystem.ts, NodeFileSystem.ts, apps/web/src/server/container.ts (wiring)
Do not touch: UI, sync, ReleaseService's own-release re-tag, apps/ios, apps/api
Verify: cd apps/web && npm run check
Done when: the mp3 writer clears a field on request, and Mp4TagEditor edits ilst items on generated m4a files (moov before and after mdat, with an iTunSMPB freeform atom) with every other box and the audio payload byte-identical, and refuses a fragmented file
```

```
Step 2 — Model: sonnet (server, routes and tests from this plan)
Read only: this plan, step 1's code, apps/web/src/server/adopt/* (guards.ts, localId.ts, AdoptService.ts), apps/web/src/server/releases/ReleaseService.ts (write paths only), apps/web/src/server/plays/LocalTrackResolver.ts, PlayCounter.ts, apps/web/src/server/spotify/PlaylistIndex.ts, apps/web/src/shared/types.ts, apps/web/src/server/storage/releaseSchema.ts, the release update route and its zod schema (grep `releases/[id]`), apps/web/src/server/config/paths.ts, SECURITY.md
Do not touch: UI, apps/ios, apps/api, the own-release re-tag
Verify: cd apps/web && npm run check
Done when: with ADOPTED_EDITS_ENABLED on, a route patches an adopted track through every step in "Every adopted write", a simulated crash at each step recovers, the snapshot and Restore round-trip every field, a play with an old id still counts, an ambiguous id counts nothing, and with the flag off every adopted write is refused
```

```
Step 3 — Model: sonnet (UI from this plan and the design entry), design judged by the session model, Codex review
Read only: this plan, docs/design.md, the owner's reference screenshot, apps/web/src/components/ReleaseView.tsx, AdoptReviewView.tsx, BulkEditDialog.tsx, the #212 playlist line component, step 2's routes and types
Do not touch: sync, apps/ios, apps/api
Verify: npm run check; screenshots of the review page (small edit, many files, playlists unknown, a partial failure) and Restore
Done when: an adopted release can be edited from its page, the review says what changes, how many files Locally didn't add and which playlists hold them (or that it can't tell yet), Ignore for this session follows decision 1, and the flag is on
```

```
Step 4 — Model: sonnet
Read only: this plan, apps/web/src/server/releases/ReleaseLayout.ts, spec/fixtures/filenames/, apps/web/src/components/SettingsView.tsx, apps/web/src/shared/types.ts (settings), apps/web/src/server/config/settingsUpdate.ts, apps/web/src/server/sync/SyncRecord.ts, SyncEngine.ts (push and upload), step 3's review page
Do not touch: apps/ios, apps/api
Verify: npm run check; screenshots of the setting and a review with renames
Done when: with the setting on, an edit renames the file by the right pattern, the review shows it, Restore renames it back, sync behaves as decision 3 says (with tests on the pushed record and the upload list), and spec/metadata.md (and spec/sync.md under decision 3a) say so
```

```
Step 5 — Model: sonnet, design judged by the session model, Codex review
Read only: this plan, docs/plans/224-artist-list.md, apps/web/src/lib/artist-names.ts, artist-index.ts, artist-catalog.ts (added by #288), the #288 artist page, step 3's review page
Do not touch: apps/ios, apps/api
Verify: npm run check; screenshots of Rename artist and its review
Done when: renaming an artist re-tags its own, adopted and featured tracks after one review, a merge says so, and a stop part-way leaves every finished release consistent
```

## Not in this plan

- Editing adopted releases on the iPhone.
- Renaming files on the iPhone.
- Adopted files on a disk other than the one holding Locally's data.
- Hard-linked files.
- MusicBrainz lookups.
