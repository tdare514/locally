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
3. **The synced name stays when Locally renames its own files (recommended, and the only safe choice today).** The owner's comment asked for the synced file names to follow a rename. They can't yet:
   - The Mac names each synced file after its own file (`SyncRecord.ts` ~194).
   - The iPhone does the same with its own file (`SyncRecord.swift` ~348). It never renames its copy, so its next push of that release would put the old name back, and the server would delete the renamed object.
   - Following renames needs a remembered remote name on every client, which is its own cross-app plan.

   **So:** each track on the Mac remembers the name it was uploaded under (a new `syncFile`, set at its first rename), and the Mac's record keeps using it. Nothing uploads again, the iPhone's next push agrees, and `spec/sync.md` holds. Only Locally ever sees the Mac's file name and the stored name differ.
   - **Older builds:** an older Mac build ignores `syncFile` and would push the new name once, uploading that file again. The iPhone's next push then puts the old name back. #119's self-heal finds the missing object and the phone re-sends it. It is untidy but recovers, and only the owner's own devices are involved.
   - **Adopted releases** upload no tracks, so their record's `file` simply follows the new name.
4. **Spotify first (owner, before step 3 merges).** On one adopted track that sits in a playlist, then restart Spotify each time:
   - Change the artist tag only, and see whether the playlist keeps it.
   - Rename the file only (same tags), and see again.

   Spotify's id is built from the tags and has no file name in it. So the expectation is that the tag change can drop the track and the rename alone doesn't. The warnings' wording and the setting's lines are final only after this test.
5. **The reference screenshot.** The owner is sending a screenshot of the current review page, as the example of what isn't clear enough. Step 3's design starts from it.

## Design

### What can be edited (Mac only): exactly the fields the model already holds
- **Release fields:**
  - the title, written as the album tag
  - the artist, written as the artist tag
  - year
  - genre
  - the cover
- **Track fields:** title, featuring (#224, written into the title), track number and disc number.
- **Preserved, never edited:** album artist and the track and disc totals. The totals are derived as today when numbers change; everything else stays as it is in the file.
- **What Locally never does to an adopted file:** move it to another folder, delete it, or add other files to the chosen folders. Renames happen only through the setting below, inside the file's own folder.

### Patch, don't flatten
- **An adopted edit is a per-file patch.** Only the fields the user changed are written. A changed release field goes to every file of that release, which shared it when #245 grouped them (decision 4: same album artist and album). Every other tag keeps each file's own value.
- **Mixed artists.** When a release's files carry different artist tags (a compilation), its Artist field is read-only with the line "These tracks have different artists." Changing it would flatten them. The artist rename (below) changes them file by file instead.
- **The adopted path is new, beside `ReleaseService`'s re-tag.** It doesn't go through the release-level writer, which stays as it is for Locally's own releases.
- **Clearing is explicit.** Year or genre set to "none" removes that tag. The writers must support it; today the ID3 writer leaves them behind on a null. It is tested for each clearable field.

### What persists and what syncs
- **`library.json`** keeps the same fields as today, with the values the review wrote. Release summaries (the library rows, the artist index, Stats) read them as they do now.
- **The sync record is unchanged in shape.** The iPhone gets the release title, artist, year, genre and cover, and each track's title, number and disc, as today.
- **Album artist and totals stay in the files only,** as they do for every release now. There is no contract change.

### Every adopted write, step by step
The write is a small transaction. Each step is durable before the next one starts: the file is fsynced, then its folder.
1. **At review,** record each file's identity:
   - its realpath, device and inode
   - its size and modified time in nanoseconds
   - a SHA-256 of its bytes
   - the device and inode of its parent folder
   - it must be a regular file with one link (lstat, not a symlink, link count 1; hard-linked files are refused for now)
2. **One at a time.** Adopted writes go through one queue on the server, so two saves can't race on the same file.
3. **Same volume only.** The work folder is `<app data>/adopted-work/`. Locally refuses a file on a different volume from its data folder (a different device id). The message reads: "Locally can only edit files on the same disk as its data for now." The owner's folders are on the Mac's main disk.
4. **Snapshot first.** On a file's first edit, the snapshot (see Undo) is written and made durable before anything else.
5. **Stage.** Copy the file into the work folder, keeping its mode, extended attributes (such as Finder tags) and dates. Write the tags to the copy and verify it:
   - It parses.
   - The changed tags read back as the new values, and every other frame or box is byte-identical to the original's.
   - The audio payload is byte-identical (the mp3 frames after the tag, or the mp4 `mdat` and the sample tables it points to).
   - The duration is unchanged.

   Then make the copy durable and record its SHA-256 (the "after" hash).
6. **Journal.** Append an entry to `<app data>/adopted-work/journal.json` (0600) and make it durable. The entry holds:
   - the release and track
   - the target path and its parent folder's identity
   - the reviewed identity and the "before" hash
   - the staged path and the "after" hash
   - the new tags and the new `localId`
   - the `library.json` change
   - its state, `staged`
7. **Swap, checked from inside the folder.** A small bundled helper, `locally-swap` (a Swift command-line tool shipped next to ffmpeg, given its paths as an argument array), does the swap:
   - It opens the target's parent folder with `O_DIRECTORY | O_NOFOLLOW` and checks its device and inode against the review.
   - It checks the target relative to that descriptor (`fstatat` with `AT_SYMLINK_NOFOLLOW`): device, inode, size and modified time.
   - It swaps the staged copy and the target in one call, `renameatx_np(…, RENAME_SWAP)`. The original isn't overwritten: it moves to the staged path, still whole.
   - **After the swap,** the displaced original must still be the reviewed file: the same device and inode, and the "before" hash.
   - **If anything differs** (another app changed or replaced the file in the gap before the swap), the helper swaps back at once. The page reports a conflict, nothing is lost, and the review opens again with fresh tags.
   - Otherwise the journal entry moves to `swapped` and is made durable.
8. **Update the library.** `library.json` gets the track's tags and `localId`, written to a temp file, fsynced and renamed into place, then its folder is fsynced. Today `JsonLibraryRepository.writeRaw` doesn't fsync; this step adds it. The journal entry moves to `committed`.
9. **Clean up.** Delete the displaced original from the work folder, then remove the journal entry.

**Recovery at the next launch** follows each journal entry's state:
- **`staged`:** the swap never happened, so the original is untouched. Delete the staged copy.
- **`swapped`:**
  - The target's hash is the "after" hash: finish step 8 and step 9.
  - It isn't (something changed the file after the swap): leave the target alone, and keep the displaced original.
- **`committed`:** finish step 9.
- **Keep, never delete, what doesn't fit.** A displaced original that couldn't be settled, and any file in the work folder with no journal entry, moves to `<app data>/adopted-recovery/`. Settings › Files lists them under "Recovered files", with Show in Finder.

The helper is macOS only. Unit tests use a fake `Swapper` through the server's container. Integration tests run the real helper on macOS, including a change injected between its checks and the swap through a test-only hook, and are skipped elsewhere.

### The writers
- **mp3: a new `Id3Patcher` that preserves the file.** node-id3 0.2.9 rebuilds the whole tag on every write (as ID3v2.3), so it can't keep the frames Locally doesn't own byte for byte. The patcher:
  - parses the ID3v2.3 or v2.4 tag into raw frames
  - replaces only the changed frames (TIT2, TPE1, TALB, TYER/TDRC, TCON, TRCK, TPOS, APIC), and removes cleared ones
  - keeps every other frame's bytes, the tag's version and its padding (it grows the tag only when the padding runs out)
  - leaves the audio after the tag untouched
  - refuses what it doesn't support: ID3v2.2, unsynchronisation, compressed or encrypted frames, an extended header it can't keep, and ID3v1-only files. The review then says "This file can't be edited yet".

  node-id3 stays for Locally's own releases.
- **m4a and mp4: a new `Mp4TagEditor` that preserves the file.** ffmpeg can't be used to write: its muxer rebuilds the metadata from the keys it knows and drops freeform `----` atoms such as `iTunSMPB` (gapless).
  - It parses the box tree.
  - It rewrites only the changed `ilst` items, and keeps every other box byte for byte.
  - When the metadata grows, it uses an existing `free` box where there is room. Otherwise it rebuilds `moov` and shifts every `stco`/`co64` chunk offset when `moov` comes before `mdat`.
  - It refuses when a shifted `stco` offset would pass 32 bits.
  - Supported: one audio track, a non-fragmented file, and `moov` either before or after `mdat`.
  - Refused: fragmented mp4 (`moof`), more than one track, a broken box tree, and boxes larger than the file. The review then says "This file can't be edited yet".
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
- **No guessing.** `resolveLocalTrack` collects every candidate before it decides:
  - adopted tracks whose current id or alias matches
  - Locally's own tracks that match by tags (the fallback, which skips adopted tracks since they always have ids)

  Candidates are de-duplicated by track. One track is a match. More than one is "ambiguous", and no play is counted. Today the adopted check returns first and the tag match never runs, so an adopted alias could take a play from one of Locally's own tracks.

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
  - Locally's own releases keep their synced names through the Mac-only `syncFile` (decision 3), so `spec/sync.md` holds. `spec/sync.md` gets one sentence: an adopted record's `file` follows a rename.
  - There is no API change, and the iPhone needs no change.
- **`spec/metadata.md`:** the `filePath` row changes from "never renamed on edit" to "renamed on edit only when the user turns on Also rename the file (Mac)".
- **iPhone:** it shows the new details. Adopted releases stay read-only there.
- **Older Mac builds:** they ignore `localIdAliases`, `syncFile`, the journal and the snapshot files.

## Security and safety

- **Every adopted write** follows the steps above: identity recorded at review, one queue, same volume, a durable snapshot, stage and verify, a durable journal, then the swap. The swap is checked from the parent folder's descriptor and keeps the displaced original until the result is confirmed. The only writes inside a chosen folder are that swap and the optional file rename.
- **The swap helper** is a bundled binary, like ffmpeg. It takes an argument array, never a shell string, and is signed with the app (#70).
- **Every path** is inside-checked after realpath, and must be a regular file with one link.
- **No shell strings.** ffmpeg (used only to read durations for verify, if needed) gets an argument array, as does the swap helper.
- **Temporary files, displaced originals, the journal, recovered files and snapshots** live in Locally's data, 0600. A file Locally can't settle is kept, never deleted.
- **`SECURITY.md`** gets a paragraph on writing adopted files (step 2).
- **Tests** use temp dirs and generated fixtures, never the owner's folders.

## Tests

- **`Id3Patcher` (mp3, generated in temp dirs, as `Id3TagService.test.ts` does):**
  - Each field changes, and clearing removes it.
  - v2.3 and v2.4 tags keep their version, every other frame's bytes, and the audio after the tag.
  - The tag grows when the padding runs out.
  - v2.2, unsynchronised, compressed or encrypted frames are each refused.
- **`Mp4TagEditor` (m4a, generated):**
  - Each field changes, and clearing removes it.
  - Every other box survives byte for byte, including a freeform `----:com.apple.iTunes:iTunSMPB`, and the `mdat` payload is identical.
  - With `moov` before `mdat`, chunk offsets stay correct when the metadata grows, and a shift past 32 bits is refused.
  - Fragmented, multi-track and unparseable files are refused.
- **The write steps:**
  - A failed verify leaves the original untouched.
  - **Recovery:** a crash in each journal state (`staged`, `swapped`, `committed`) recovers at the next launch, and an unsettled original or a stray work file lands in "Recovered files".
  - **Conflicts:**
    - A file changed between review and the swap (same size and modified time, new content) is refused.
    - A change injected between the helper's checks and its swap is swapped back, with the original intact (macOS integration test).
    - A parent folder replaced by a symlink before the swap is refused.
  - **Refusals:** a different volume, a symlink, a hard link and a path outside the roots are each refused.
  - **Kept:** the mode and extended attributes.
  - **`library.json`:** it is written with fsync, through a temp file and a rename.
- **Patching:** a three-track folder with different track artists keeps them after an album-only edit, and its Artist field is read-only.
- **Persistence:** `library.json` and the pushed record hold the written values; album artist and totals never reach either.
- **The snapshot:**
  - It is written once, with the artwork even when the first edit doesn't touch the cover.
  - Restore brings back every field, absent fields included, plus the artwork and the name.
  - "Remove from Locally" deletes it.
- **Plays:**
  - Several edits in a row keep every alias until Spotify reports the current id.
  - An alias shared by two tracks gives "ambiguous" and no count, and so does an adopted alias that also matches one of Locally's own tracks by tags.
  - Restore keeps matching.
  - Adopted tracks never match through the tag fallback.
- **Playlists:** known, unknown (still checking, stale, failed, not connected) and none, and "Ignore for this session" is refused while unknown.
- **The rename:**
  - Each pattern of decision 2 is detected, and an unknown pattern keeps the name.
  - Collisions get " (2)". The #85 and #87 fixtures pass, and the extension is never changed.
  - Sync per decision 3: after a rename of Locally's own file, the pushed record keeps `syncFile` and nothing uploads; an adopted record's `file` follows the new name.
- **The review model:** the counts (files, not added by Locally, renames), and which warnings "Ignore for this session" skips.
- **The artist rename:** the plan of changes across own, adopted and featured tracks, the merge message, and a stop part-way through.
- **UI:**
  - Screenshots: the review page (a small edit, a rename, the artist rename, playlists unknown), the setting, and Restore.
  - The slide-to-confirm works with the keyboard and has VoiceOver labels.

## Rollout (each an issue with a session brief)

0. **Owner:** decisions 1 to 3 (3 is a recommendation, with the owner's comment as the reason to object), the Spotify test (decision 4), and the reference screenshot (decision 5).
1. **The pieces, three sessions that can run at the same time. Server only.**
   - **1a:** `Id3Patcher`.
   - **1b:** `Mp4TagEditor`.
   - **1c:** the `locally-swap` helper, its build script and packaging next to ffmpeg, the `Swapper` interface with its fake, and the `library.json` fsync.
2. **The adopted write path:**
   - the patch model and the guard change
   - identity, the queue, staging and verify, the journal and recovery, and "Recovered files" on the server
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
Step 1a — Model: sonnet (a byte-level parser and writer from this plan, with generated fixtures)
Read only: this plan (The writers: mp3; Tests: Id3Patcher), apps/web/AGENTS.md, apps/web/src/server/audio/TagService.ts, Id3TagService.ts, apps/web/tests/unit/Id3TagService.test.ts (how fixtures are made in temp dirs)
Do not touch: UI, sync, Id3TagService (it stays for Locally's own releases), apps/ios, apps/api
Verify: cd apps/web && npm run check
Done when: Id3Patcher changes and clears each field on generated v2.3 and v2.4 files with every other frame, the version, the padding rule and the audio byte-identical, and refuses v2.2, unsynchronised, compressed and encrypted frames
```

```
Step 1b — Model: sonnet (a byte-level parser and writer from this plan, with generated fixtures)
Read only: this plan (The writers: m4a and mp4; Tests: Mp4TagEditor), apps/web/AGENTS.md, apps/web/src/server/audio/TagService.ts, apps/web/tests/unit/Id3TagService.test.ts (fixture pattern), apps/web/src/server/audio/FfmpegConverter.ts (to make m4a fixtures with the dev ffmpeg)
Do not touch: UI, sync, apps/ios, apps/api
Verify: cd apps/web && npm run check
Done when: Mp4TagEditor edits and clears ilst items on generated m4a files (moov before and after mdat, with an iTunSMPB freeform atom) with every other box and the mdat payload byte-identical, refuses a 32-bit offset overflow, and refuses fragmented and multi-track files
```

```
Step 1c — Model: sonnet (a small native tool and its wiring)
Read only: this plan (Every adopted write: step 7, Recovery; Security), apps/web/AGENTS.md, apps/web/package.json (desktop scripts), the ffmpeg build and packaging scripts it names, apps/web/electron-builder config, apps/web/src/server/container.ts, apps/web/src/server/storage/JsonLibraryRepository.ts
Do not touch: UI, sync, apps/ios, apps/api
Verify: cd apps/web && npm run check; on macOS, the helper's integration tests (swap, swap-back on an injected change, refused symlinked parent)
Done when: locally-swap builds from a script, is packaged beside ffmpeg, swaps with RENAME_SWAP relative to the parent folder's descriptor and swaps back on a mismatch, the server reaches it only through a Swapper interface with a fake for unit tests, and library.json is written with fsync through a temp file
```

```
Step 2 — Model: sonnet (server, routes and tests from this plan)
Read only: this plan, step 1a/1b/1c's code, apps/web/src/server/adopt/* (guards.ts, localId.ts, AdoptService.ts), apps/web/src/server/releases/ReleaseService.ts (write paths only), apps/web/src/server/plays/LocalTrackResolver.ts, PlayCounter.ts, apps/web/src/server/spotify/PlaylistIndex.ts, apps/web/src/shared/types.ts, apps/web/src/server/storage/releaseSchema.ts, the release update route and its zod schema (grep `releases/[id]`), apps/web/src/server/config/paths.ts, SECURITY.md
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
Done when: with the setting on, an edit renames the file by the right pattern, the review shows it, Restore renames it back, the pushed record keeps syncFile for Locally's own files and nothing uploads again (tests on the pushed record and the upload list), an adopted record's file follows the new name, and spec/metadata.md and spec/sync.md say so
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
