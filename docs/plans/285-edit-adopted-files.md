# #285: edit adopted files in place on the Mac, with one clear review page (and the artist rename)

## Why

The owner, 16 Oct: people should be able to fix the files adopted from the Mac's Spotify folders (#245), "that's the whole point". A file that arrives untagged can't be fixed while adopted releases are read-only. #245 made them read-only for v1, because an edit changes Spotify's id for the file, and left "editing with a playlist warning" for later. This is that step.

The same review page also covers renaming an artist everywhere (#224, decision 3), and the owner's follow-up (comment, 16 Oct): a setting to also rename the file to match its tags.

## What is true today

- **Adopted releases** (`adopted: true`, `apps/web/src/shared/types.ts`) live in the folders listed in `settings.adoptRoots`. Formats: mp3, m4a and audio-only mp4 (#245 decision 3).
- **The guard:** `assertWritable(release)` (`apps/web/src/server/adopt/guards.ts`) refuses every write path for an adopted release: `ReleaseService` (re-tag, cover, delete files, accept, Send) and `SyncEngine`. Reads are allowed inside `adoptRoots` after realpath (`isReadablePath`), so a symlink pointing out of a root is refused.
- **Tag writing on the Mac** is ID3 only (`Id3TagService`, node-id3). Locally's own library is all mp3 (non-mp3 imports are converted), so there is no m4a writer. ffmpeg is bundled (#69).
- **Spotify's id** for a local file is `spotify:local:<artist>:<album>:<title>:<seconds>` (`apps/web/src/server/adopt/localId.ts`). Plays match an adopted track by its stored `localId` first (`LocalTrackResolver.resolveAdopted`). Change the artist, album or title tag and Spotify sees a new id, so playlists that hold the old one may lose the track.
- **Playlists:** `PlaylistIndex.forRelease(releaseId)` (#212) says which of the owner's playlists hold each track, when Spotify is connected.
- **File names:** both apps re-tag in place and never rename (`spec/metadata.md` `filePath`; STATUS "re-tagged, never renamed"). In `spec/sync.md`, `tracks[].file` "names the stored object; the name never changes after upload". For an adopted release it is just the file's own name: no track is uploaded.
- **Review pages today:** the iPhone's "Check your changes" (#220, old value struck through above the new one) and the Mac's adopt review (`AdoptReviewView`). The Mac's bulk edit has no review.

## Decisions for the owner

1. **Which warnings "Ignore for this session" can skip (recommended).** The swipe hides, until Locally quits, the review page for a plain tag edit of up to 20 adopted files. It never skips:
   - a rename of any file
   - the library-wide artist rename
   - an edit of more than 20 files
   - the first edit of a file that is in a Spotify playlist
2. **Name pattern for renamed adopted files (recommended: keep the folder's style).** Locally reads the file's current name against a few known patterns, built from its current tags: "03 Title", "03 - Title", "Artist - Title", "Title". When one matches, the new name uses the same pattern with the new tags. When none matches, the file keeps its name and the review says so ("Keeps its name: Locally can't tell how it's named"). The alternative is always Locally's "03 - Title", which renames files the user may have named on purpose.
3. **Renaming Locally's own files and sync (recommended: Mac only).** A renamed track in Locally's own library is renamed on the Mac only. The sync record keeps the stored object's name, as `spec/sync.md` requires, so the iPhone's copy keeps its old name and nothing uploads again. If the record followed the new name instead, that would be a contract change: the API would have to move stored objects and the iPhone would have to rename its files. That would be a separate plan. Adopted releases have no stored object, so their record's `file` follows the new name.
4. **Spotify first (owner, before step 3 merges).** Rename the artist of one adopted track that sits in a playlist, restart Spotify, and see whether the playlist keeps it. What happens decides the warning's wording: "may drop out of", or "will drop out of until you add it again".
5. **The reference screenshot.** The owner is sending a screenshot of the current review page, as the example of what isn't clear enough. Step 3's design starts from it.

## Design

### Re-tag in place (Mac only)
- **Fields:** title, artist, featuring (#224, written into the title), album, year, genre, track and disc numbers, and the cover.
- **What Locally never does to an adopted file:** move it to another folder, delete it, or add other files to the chosen folders. Renames happen only through the setting below, inside the file's own folder.
- **`assertWritable` becomes `assertTagWritable(release, files)`:**
  - It allows a tag rewrite of an adopted file after review.
  - Every file is inside-checked against `adoptRoots` after realpath, and it must be a regular file (lstat, not a symlink).
  - It refuses a file whose size or modified time changed since Locally last read it. The page then re-reads the tags and shows the review again.
  - Deleting files, accept and Send still refuse adopted releases, exactly as today.
- **A safe write, for both formats:**
  1. Copy the file to Locally's data (`<app data>/adopted-work/`).
  2. Write the tags to the copy.
  3. Read the copy back: the tags must be the new ones, the duration must be within 0.5 s, and the audio stream must be untouched.
  4. Rename the copy over the original. When the folder is on another volume, keep a backup of the original in Locally's data, copy over it, verify, and only then drop the backup.
  - **mp3:** node-id3 on the copy, which keeps the frames it doesn't own.
  - **m4a and mp4:** a new `Mp4TagService`. It is ffmpeg with `-map 0 -c copy -map_metadata 0`, plus the changed keys and the cover as an attached picture. Step 1 checks it keeps every other atom (gapless info, freeform `----` atoms) on fixtures. If ffmpeg drops any, it falls back to a small `ilst` editor that rewrites only the changed atoms.

### Undo: "Restore original tags"
- **Before the first edit** of an adopted file, Locally saves its original tags in `<app data>/adopted-originals/<release id>.json` (0600). The snapshot holds:
  - title, artist, album, year, genre, track, disc, and the original file name
  - the original `localId`
  - the embedded cover's bytes, as `<release id>/<track id>.<ext>`, only when the cover changes
- **Later edits** never overwrite the snapshot.
- **"Restore original tags"** (on the release page, for an adopted release with a snapshot) shows the review, then writes the snapshot back and renames the file back. A name that is now taken gets " (2)". Afterwards it deletes the snapshot.
- **"Remove from Locally"** deletes the snapshot too.

### Plays keep matching
- After a write, the track's `localId` is rebuilt from the new tags (`buildLocalId`). The old id moves to `previousLocalIds`, which keeps the last 3.
- Spotify keeps reporting the old id until it re-reads the file. `resolveAdopted` matches the old ids as well as the current one, so no play is lost in between.

### The review page (one page for every edit that reaches into files Locally didn't add)
- **Used for** any save that writes an adopted file, any rename, and the artist rename. A save of Locally's own files without a rename keeps today's direct save.
- **Content, in plain words, top to bottom:**
  - **What changes:** each field as before → after (old value struck through above the new one, as on the iPhone's #220 page). Each rename shows the old file name struck through above the new one.
  - **The summary:** "Changes 12 files. 9 of them came from your Spotify folders." Renames are counted on their own: "Renames 4 files."
  - **Playlists:** "In 3 of your Spotify playlists: Night drive, Gym, Sunday. Spotify may drop these tracks from them until you add them again." The list comes from the #212 index. Without a Spotify connection the line reads "Locally can't see your playlists. Spotify may drop edited tracks from them."
  - **Restart:** "Spotify shows the new details after you restart it."
  - **Undo:** "You can restore the original tags from the release page."
  - **Actions:** Save (primary), Cancel, and **Ignore for this session** as a slide-to-confirm track, for the warnings decision 1 allows.
- **Tone:** clear without being alarming. One warning colour, used only for the playlist line. No all-caps labels.
- **The design entry** for the page goes in `docs/design.md` first, as #245 did.

### Setting: "When you edit a track" (Settings › Files)
- **Change the tags only** (the default). Picture: "03 Midnight.mp3" keeps its name and only the tag card changes. Line: "The file keeps its name, so Spotify playlists keep the track."
- **Also rename the file to match.** Picture: "03 Midnight.mp3" becomes "03 Midnight (feat. B).mp3". Line: "Spotify sees a renamed file as a new one, so it leaves your playlists until you add it again."
- **Scope:**
  - The setting applies to Locally's own library and to adopted files, on the Mac.
  - The iPhone keeps never renaming (its AGENTS rule) and keeps adopted releases read-only.
- **The rename itself:**
  - The new name keeps the extension and stays in the file's folder.
  - It is sanitised by `ReleaseLayout` (#85 rules, the #87 byte limit) and inside-checked against the library or the adopt root.
  - A name that is taken gets " (2)".
  - A rename runs after the tag write succeeds. If the rename fails, the tags stay written and the review's result says so.
- **The pattern:**
  - Locally's library keeps its pattern, "03 - Title.mp3" (`ReleaseLayout.trackFileName`), with the title in its "Song (feat. B)" form.
  - Adopted files follow decision 2.

### Renaming an artist everywhere (#224, decision 3)
- **Where:** a "Rename artist…" action on the artist page (#288). It takes a new spelling, with suggestions and "Did you mean" from #287.
- **What it touches:** every release whose main artist has that key, and every track that features it (the name inside "(feat. …)"). That covers Locally's own files and adopted ones alike.
- **The review page** groups the changes by release. Locally's own files get a re-tag; adopted files go through the safe write and the snapshot; the rename setting applies to both.
- **Merging:** renaming to an existing artist's spelling merges the two. The review says so: "The Weeknd already has 12 tracks. These 3 join them."
- **Progress:** it runs one release at a time with a progress line and can be stopped between releases. The result lists what failed, by title.

## Contract and compatibility

- **Sync:** details sync as today. An edited adopted release pushes its new details with `source: "adopted"`, and its `tracks[].file` follows a rename (it was only ever the file's own name). Locally's own releases keep the stored object's name (decision 3). There is no API change.
- **`spec/metadata.md`:** the `filePath` row changes from "never renamed on edit" to "renamed on edit only when the user turns on Also rename the file (Mac)". `spec/sync.md` gets one sentence on an adopted record's `file` following a rename.
- **iPhone:** it shows the new details. Adopted releases stay read-only there; an edit on the phone would need the Mac to write the file, which is a later step.
- **Older Mac builds:** they ignore `previousLocalIds` and the snapshot files.

## Security and safety

- **Every write** is inside-checked after realpath against `adoptRoots` or the library, is a regular file, and goes through the copy, verify and swap flow. There are no shell strings: ffmpeg gets an argument array.
- **Never in a chosen folder:** temporary files, backups and snapshots live in Locally's data.
- **A file that changed** since Locally read it is never overwritten blind.
- **Tests** use temp dirs and fixtures, never the owner's folders.

## Tests

- **The safe write (mp3 and m4a fixtures in temp dirs):**
  - tags change, other frames and atoms survive, and the duration and audio bytes are unchanged
  - a failed verify leaves the original untouched
  - the cross-volume path is covered (simulated)
  - a file whose size or modified time changed is refused
  - a symlink is refused, and so is a path outside the roots
- **The snapshot:** it is written once and never overwritten by later edits. Restore puts the tags and the name back. "Remove from Locally" deletes it.
- **`localId`:** it is rebuilt after an edit, and plays match the current id and the previous ones.
- **The rename:** each pattern of decision 2 is detected, and an unknown pattern keeps the name. Collisions get " (2)". The #85 and #87 fixtures pass, and the extension is never changed.
- **The review model:** the counts (files, not added by Locally, renames), the playlist line with and without a connection, and which warnings "Ignore for this session" skips.
- **The artist rename:** the plan of changes across own, adopted and featured tracks, the merge message, and a stop part-way through.
- **UI:** screenshots of the review page (a small edit, a rename, the artist rename), the setting, and Restore. The slide-to-confirm is tested with the keyboard and VoiceOver labels.

## Rollout (each an issue with a session brief)

0. **Owner:** the Spotify test (decision 4), and the reference screenshot (decision 5).
1. **The safe write and the m4a writer.** Server only, no UI.
2. **Editing adopted releases:** the guard change, the snapshot, `localId`, Restore, and the routes. Behind a flag until step 3.
3. **The review page** and editing adopted releases in the UI. Codex reviews the design.
4. **The rename setting** and file renames (own and adopted).
5. **Rename an artist everywhere** from the artist page. It needs #288.

Session briefs:

```
Step 1 — Model: sonnet (spec'd server code with fixtures)
Read only: this plan, apps/web/AGENTS.md, apps/web/src/server/audio/*, apps/web/src/server/adopt/guards.ts, apps/web/src/server/config/paths.ts, fixtures/
Do not touch: UI, sync, apps/ios, apps/api
Verify: cd apps/web && npm run check
Done when: an mp3 and an m4a fixture in a temp dir are re-tagged through copy, verify, swap with every other frame or atom intact, and a failed verify leaves the original untouched
```

```
Step 2 — Model: sonnet (server and routes from this plan)
Read only: this plan, step 1's code, apps/web/src/server/adopt/*, apps/web/src/server/releases/ReleaseService.ts (write paths), apps/web/src/server/plays/LocalTrackResolver.ts
Do not touch: UI, apps/ios, apps/api
Verify: cd apps/web && npm run check
Done when: an adopted release can be re-tagged through the route behind a flag, the snapshot is written once, Restore puts the tags back, and a play with the old localId still counts
```

```
Step 3 — Model: sonnet (UI from this plan and the design entry), design judged by the session model, Codex review
Read only: this plan, docs/design.md, the owner's reference screenshot, apps/web/src/components/ReleaseView.tsx, AdoptReviewView.tsx, BulkEditDialog.tsx, the #212 playlist line
Do not touch: sync, apps/ios, apps/api
Verify: npm run check; screenshots of the review page (small edit, many files, no Spotify connection) and Restore
Done when: an adopted release can be edited from its page, the review says what changes, how many files Locally didn't add and which playlists hold them, and Ignore for this session works as decision 1 says
```

```
Step 4 — Model: sonnet
Read only: this plan, apps/web/src/server/releases/ReleaseLayout.ts, the #85 and #87 fixtures, SettingsView.tsx, step 3's review page
Do not touch: apps/ios, apps/api, spec/sync.md beyond the one sentence
Verify: npm run check; screenshots of the setting and a review with renames
Done when: with the setting on, an edit renames the file by the right pattern, the review shows it, and Restore renames it back
```

```
Step 5 — Model: sonnet, design judged by the session model, Codex review
Read only: this plan, docs/plans/224-artist-list.md, the #288 artist page, the step 3 review page, apps/web/src/lib/artist-catalog.ts
Do not touch: apps/ios, apps/api
Verify: npm run check; screenshots of Rename artist and its review
Done when: renaming an artist re-tags its own, adopted and featured tracks after one review, a merge says so, and a stop part-way leaves every finished release consistent
```

## Not in this plan

- Editing adopted releases on the iPhone.
- Renaming files on the iPhone.
- The sync record following a rename of Locally's own files (decision 3's alternative).
- MusicBrainz lookups.
