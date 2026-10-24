# #339: Collections, mixtapes you play on a record player

## What the owner wants (23 Oct)

- **The name is "Collections".** The look carries the character. The brand may change (#335), so the brand never goes in
  the feature's name.
- **A collection holds single tracks and whole releases, in an order the owner sets:** a true mixtape. Owners will make
  lots of them ("people would like to go crazy"): moods, versions of a playlist, one per trip.
- **Rules come later.** The first build is hand-picked only. "Everything by Okoro" or "added this month" is a later step that
  adds an optional key to the record.
- **The look is a record player** (chosen from the variants below):
  - The Collections page has a **record wheel** on the left: each collection is a row (a small record with its cover as the
    label, then the name and track count; later made a picture disc, see "The look") riding the right half of a dial whose hub sits on the window's left edge. The front
    row is biggest and points at the turntable; the others shrink and fade as they go round. It scrolls, drags and swipes,
    snaps to each row, and turns endlessly, so 24 collections or 200 feel the same. No full covers on the wheel: the cover
    shows once, over the turntable (owner, 23 Oct).
  - On the right, a **turntable** plays a collection. The cover hovering over the record **follows the wheel**: the front
    collection's cover with a Play button, or, when the front collection is the one playing, the current track's cover.
  - **Browsing never stops the music.** The record keeps spinning while you turn the wheel to look at other collections; the
    deck's controls stay on what's playing, with "Back to {name}" to turn the wheel home.
  - Under them, the **queue** lists the front collection's tracks, Side A then Side B. Tapping one plays that collection from there.
  - **On the iPhone** the record player steps into the background (owner, 23 Oct): the playing record turns in the wheel's
    hub on the left edge with the current track's cover as its label, the rows orbit it, and there is no deck and no
    hovering cover. The "Playing" row is how you see what's on. The wheel is larger, so fewer rows show and you scroll more.
  - The record player replaces the per-collection styles in the issue (Shelf, Tape, pocket player). Tape and the pocket
    player can come back later as other objects on the wheel.
- **Where it lives:** the top of the Library on both apps, as a slim row of the collections' records and "New collection".
  Tapping one opens the Collections page with that record on the platter.
- **Spotify: the guide, plus a paste test** (owner, 23 Oct, replacing "make it a Spotify playlist on request"; see the spike).
- **Sharing a collection** (#146) comes later, not in this plan.
- **Playing** queues the collection in Locally's own player (#336 and #337 on the iPhone, #338 on the Mac, plan
  `docs/plans/324-play-in-locally.md`). Plays count like any Locally play, with `source: "locally"` (#340).
- **Standalone** (#332, `docs/plans/332-standalone-devices.md`): collections are made, edited and played on the iPhone alone
  and on the Mac alone, and they sync between devices.

## The spike: Spotify can't add a local file to a playlist

Recorded on #339 (comment of 23 Oct).

- The Web API's playlist concepts page still says: "It is not currently possible to add local files to playlists using the
  Web API." `POST /playlists/{id}/items` takes catalogue track and episode URIs only. `docs/research/playlists.md` §2 found
  the same 400 as recently as December 2025.
- Locally's tracks only have `spotify:local:` ids (`tracks[].localId`, #303), never catalogue ids. A catalogue-only playlist
  would mean searching for each track (dev mode caps a search at 10 results), with most tracks missing or a different version.
- No live call was made. The documented answer is unambiguous, and nothing was written to the owner's account.
- **So:** a collection gets the #21 guide (below), and no new Spotify scope is added. The owner runs a one-minute paste test
  (steps on #339): if pasting `spotify:local:` URIs into a Spotify playlist on the Mac works, a "Copy for Spotify" button
  becomes its own issue.

## The model

```json
{
  "syncVersion": 1,
  "id": "9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13",
  "name": "Late drives",
  "items": [
    { "kind": "release", "releaseId": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90" },
    { "kind": "track", "releaseId": "7a0d…", "trackId": "c41e…" }
  ],
  "origin": "mac",
  "originDevice": "Toby's MacBook",
  "createdAt": "2026-10-23T20:00:00Z",
  "updatedAt": "2026-10-23T20:00:00Z",
  "deleted": false
}
```

- **`name`:** 1 to 100 characters after trimming, no control characters.
- **`items`:** 0 to 1,000, in the owner's order.
  - A `release` item plays all of that release's tracks in release order (disc, then track), read when it plays, so an
    edit to the release flows through.
  - A `track` item plays that one track.
  - The same release item, or the same track item, appears at most once. A track item from a release that is also a
    release item is allowed: the owner chose to hear it twice.
- **The cover** is not stored. It is the 2×2 of the first four different covers among the items, or one cover when there is
  only one. Every device computes it. A chosen cover is a later step.
- **No display style is stored.** Every collection is a record on the wheel. The Record player / List switch is a per-device
  preference.
- **Side A and Side B** are display only: the queue split in half (the extra track goes on Side A).
- **Items a device can't resolve** (a release not pulled yet, a deleted release, a track id the release no longer has) are
  hidden on the page and skipped when playing. They stay in the record until the owner next saves that collection on a
  device that knows they're gone, or the API drops them (below).
- **Items whose audio isn't on this device** (#332 holdings, for example a Mac-only adopted release) show dimmed with the
  devices line ("On your Mac") and are skipped when playing, as #324's rows that can't play.
- **Forward compatibility:** a client MUST keep an item whose `kind` it doesn't know, unchanged, when it re-pushes the record,
  and skip it on the page and when playing. The API keeps it too (see "Contract"). Unknown top-level keys follow the release record's rule: older clients ignore
  them, and dropping one on a re-push is accepted because only the owner's own devices sync and they update together.

## Contract (`spec/sync.md` gets its own "Collections (#339)" section; `apps/api`)

| Method and path | Body / query | Returns |
| --- | --- | --- |
| GET `/v1/collections?sinceVersion=N&limit=N` | `limit` 1 to 200, default 200, as for releases | `{ collections: [record + version], nextVersion, hasMore }`, tombstones included, with exactly the paging rules of `GET /v1/releases` (#30) |
| PUT `/v1/collections/:id` | the record | `{ version, pruned }`; 409 when the stored `updatedAt` is newer (last writer wins); 400 for a bad shape. `pruned` counts items the API dropped (below) |
| DELETE `/v1/collections/:id` | | tombstone; `{ version }` |

- **Ownership:** a collection id belongs to the user that first wrote it. Another user's id answers 404 on every route.
- **Last writer wins on the whole record,** as for releases: two devices that rename or reorder the same collection offline
  overwrite each other, and the loser gets a 409, pulls, and re-applies through the existing pull flow. Edits are rare and
  only the owner's devices sync, so no merge is attempted.
- **Item kinds:** `release` and `track` are validated strictly (a known kind with a bad shape is a 400). An item with any
  other `kind` matching `^[a-z][a-z0-9-]{0,15}$`, an object of at most 1 KiB, is stored and returned unchanged, so a newer
  client's items survive an older API and older clients.
- **Limits:** at most 1,000 live collections per user (a new one beyond answers 409 `{ "error": "too_many_collections" }`),
  1,000 items per record, and the existing 1 MiB body cap.
- **Versions** come from the same per-user counter as releases (`user_counters`). Each list pages its own table, so a
  collection write can move `nextVersion` in a release page, which the release rules already allow.
- **A deleted release leaves its collections:**
  - When a release is tombstoned (`DELETE`, or a `PUT` with `deleted: true` that wins), the same batch drops that release's
    items from the user's live collections and bumps their `version`, `updatedAt` and `serverUpdatedAt`, the way
    `ReleaseSyncService.revokeSharesOf` revokes its shares.
  - A `PUT` of a collection also drops items that name one of the user's tombstoned releases, so an offline device can't
    bring them back. The check runs in the same transaction as the write, so a release deleted at the same moment can't slip
    through, and the reply's `pruned` tells the client to pull that collection back rather than keep its own copy.
  - Items naming a release the server doesn't know yet are kept. Clients push releases before collections, but nothing
    depends on that order.
- **Storage:** a `collections` table (`id`, `user_id`, `version`, `record` JSON, `updated_at`, `deleted`, `server_updated_at`,
  an index on `user_id, version`). The migration is additive, so the owner reviews it.
- **Account deletion** removes the user's collections in the deletion transaction.
- **Effect on clients:** none until they call these routes. A client meeting a 404 for `/v1/collections` (an older API)
  skips collection sync quietly. Release records, plays and shares don't change.

## The player

- Both players take a queue of track refs `{ releaseId, trackId }` plus a context `{ kind: "release" | "collection", id }`
  (the Mac from #338; the iPhone from #337, which generalises #336's release-bound queue).
- **Playing a collection** builds that list: each release item becomes its tracks (disc, then track), each track item itself,
  skipping what this device can't play. The context is the collection, so tapping the mini player opens the Collections
  page with that record on the platter.
- **Turning the wheel** only previews: the page takes the front collection's colours, its cover hovers over the turntable with
  a Play button, and the queue shows its tracks. Playback carries on. Play (or tapping the front row, or Enter) puts it on the
  platter from its first track; tapping a queue row plays it from there.
- **Counting** is unchanged: a play from a collection is a Locally play like any other.

## Mac (`apps/web`)

- **Store:** `collections.json` in the config dir (atomic write, 0600 like the other config files): the records plus a pushed
  marker per collection. The pull cursor joins the sync state.
- **Sync:** reconcile pushes releases, then changed collections, then deletes; it pulls `/v1/collections` pages after
  releases. A 404 or 429 is skipped quietly.
- **Local routes:** `GET /api/collections`, `POST /api/collections`, `PUT /api/collections/:id` and
  `DELETE /api/collections/:id`, behind the existing loopback Host and origin checks and validated with zod. The demo serves
  three invented collections and answers 403 to writes, like every demo route.
- **Library:** a "Collections" section above Singles and Albums: a slim row of records (cover, name, track count) and
  "New collection", folding like the other sections (remembered).
- **The Collections page:** the record wheel, the turntable and the queue, with a List view (rows of cover, name, count and
  length, and a search field) behind the Record player / List switch, remembered in localStorage.
- **The wheel's keys** (only when the wheel itself has focus): ↑ and ↓ turn it, Home and End jump to the first and last,
  typing a name jumps to it, Enter plays the front collection. The + and the hub's ▲ ▼ are buttons outside the list.
- **Adding:** "Add to collection" on track rows (the hover menu and right-click), the release bar and Library bulk select. A
  popover lists the collections (with a search field once there are more than 8) and "New collection…".
- **Editing:** "Edit collection" turns the queue into an edit list: rename, drag a row by its grip, Move up and Move down in
  each row's menu and with Option-↑ / Option-↓ on a focused row (a non-drag way to reorder, WCAG 2.5.7), remove, and Delete
  collection after a confirm.

## iPhone (`apps/ios`)

- **Model:** a SwiftData collection model beside the library's (an additive model). `SyncOutbox` gains collection puts and
  deletes, retried each reconcile like releases.
- **Sync:** the same order and rules as the Mac.
- **Library:** the same slim row at the top of the Library tab.
- **The Collections screen:** the half wheel across the screen with the playing record turning in its hub (no deck, no
  hovering cover), now playing and the queue below, and the List view with a search field. Rows show the name and track
  count; the length is in the List view and VoiceOver.
  - **Gestures:** a vertical drag that starts on the wheel turns it, like the system's picker wheels inside a scrolling form;
    the page scrolls from anywhere else. Tapping the row above or below turns to it, so no drag is ever needed. (Codex
    suggested horizontal swipes; the owner asked to scroll the left side with a finger, so the wheel keeps the vertical drag.)
  - A light selection haptic as each record snaps into place.
  - The wheel and the spin pause in the background and in Low Power Mode, as the backdrops do.
- **Adding:** the track row's context menu and swipe action, and "Add to collection" on the release page, open a sheet with
  the collections and "New collection".
- **Editing:** a list in edit mode with `.onMove`, VoiceOver custom actions "Move up" and "Move down", rename and delete.

## The look (both apps; details go into `docs/design.md` in the design steps)

- **The prototype** (private): https://claude.ai/artifact/2J5qUxPQRrXSFa1jyzuRx7. **Screenshots:** `docs/design-previews/339/`.
  - `mac-record-player.png` (on the playing collection), `mac-record-player-browsing.png` (looking at another while one plays),
    `mac-record-player-vinyl.png` (the Black vinyl choice), `phone-record-player.png` and `phone-record-player-browsing.png`
    are the chosen direction.
  - `*-spines`, `*-crate`, `*-ledge`, `*-turntable` and `*-plain` are the variants explored on the way, kept for the record.
- **The wheel:** rows on the right half of a dial whose hub sits on the left edge. A row is a small picture disc (72 on the Mac,
  52 on the iPhone): the collection's first cover printed edge to edge, faint grooves over it and a centre hole (owner, 23 Oct;
  only these small records, the big spinning record keeps black vinyl with the track's cover as its label), then the name (20 / 15, white) and "27 tracks, 1 hr 56 min"
  on the dark page, never over artwork. Each step round is 0.87 of the last. Rows follow the dial's curve but stay level,
  reading left to right (owner, 23 Oct), and fade past about 50° from the front, so about seven show at once. The playing collection's record turns and its row says "Playing" or
  "Paused" in the accent colour. The hub shows "5 of 24", ▲ and ▼ (Mac) and a + for a new collection, all 44 buttons. A thin
  ring and an accent notch point at the turntable.
- **The turntable (Mac):** a deck in the app's glass, the platter seen at an angle (a circle flattened to an ellipse, no 3D library),
  a tonearm that swings onto the record when it plays, the hovering cover (above), and now playing on the deck's right (on the
  iPhone, under it), with "Back to {name}" while browsing.
- **A Records switch** (Picture disc / Black vinyl) sits beside Record player / List, remembered per device (owner, 23 Oct):
  picture disc is the default; black vinyl shows the rows' records as vinyl with the cover as a small label. Changing it
  redraws only the wheel.
- **The iPhone's record:** the wheel's hub is the playing record (the hub's radius, its label the current track's cover,
  a dark platter rim), turning at 33⅓ rpm while playing and still when paused. The count and + sit under the wheel. Under it, now playing, with the previous, play and next buttons centred (owner, 23 Oct).
- **The queue:** Side A and Side B columns on the Mac (one column on the iPhone); the current track carries the #324
  now-playing glyph in the accent colour.
- **Colour:** the page takes the front record's cover colours, as the release page does.
- **Motion budget** (`~/.claude/design/motion.md`, the house record easing):
  - the wheel turning and snapping, animated only while it moves;
  - the record onto the platter and the tonearm's swing;
  - the hovering cover rising in;
  - the record spinning at 33⅓ rpm (1.8 s a turn) while playing, and still when paused.
  - Nothing else moves. Only transforms and opacity animate, and only the rows near the front are laid out each frame (the
    rest are skipped before any maths), so 200 collections cost the same as 20. Nothing that moves uses `backdrop-filter`;
    labels over art sit on an opaque dark surface.
  - The spin, the wheel and the record rows pause when the page is hidden or scrolled out of view, on both apps, and in Low
    Power Mode on the iPhone.
- **Reduce Motion:** the wheel jumps from record to record, nothing spins, and the cover appears without rising.
- **Steady while browsing** (acceptance criteria, Codex round 2): turning the wheel, pausing, skipping and switching
  collections update the deck in place. The record never remounts or restarts its turn, and keyboard focus stays on the
  control that was pressed (a queue row that re-renders gets focus back).
- **Hit areas:** every row keeps a 44 pt tap area however small its art is scaled, and the hovering cover's Play button is
  44 pt tall.
- **One source for state:** the visible "Playing" / "Paused" and every accessible label come from the same player state, so
  VoiceOver says "paused" when it is.
- **Accessibility:**
  - The wheel is one focusable control (a listbox with `aria-activedescendant` on the Mac). Its keys act only when the wheel
    itself has focus, so Enter on a nearby button never starts playback. On the iPhone it is a VoiceOver adjustable element:
    swipe up or down to change the collection, double-tap to play.
  - Full names are always available in text (the rows, the List view, VoiceOver), never only inside cropped art.
  - Every record has its full label ("Late drives, 27 tracks").
  - At the accessibility text sizes the wheel's art and captions stop growing (like the Library cloud's badge), while now
    playing and the queue scale fully.

## States and wording

| State | What shows |
| --- | --- |
| No collections | The wheel's place holds one empty record and "Make your first collection: a mixtape of any tracks and releases." with **New collection**. The Library row shows the same line, smaller. |
| An empty collection | Its row says "0 tracks"; the queue says "Nothing here yet. Add tracks from any release or track row." with **Add tracks**. Play is disabled. |
| No playable tracks on this device | The queue lists them dimmed with the devices line ("On your Mac"); Play is disabled with "None of these tracks are on this iPhone." |
| Loading (first open, before the local store is read) | The wheel's rows and the queue as quiet placeholders in their final shapes, for at most a moment; no spinner. |
| A track fails to play | The player skips to the next playable track and the row shows "Couldn't play this track" with **Try again**. |
| Paused | The record and the row's record stop turning, the tag and the row say "Paused", the tonearm stays on the record. |
| Narrow (320) and the largest text | Checked in the design steps with screenshots; the rows' names stop growing with the art and the full name is in VoiceOver and the List view. |

## Make it a playlist (the Spotify guide)

- The Collections page gets the #21 "Make it a playlist" disclosure under the queue: Copy for the collection's name, the
  tracks in the collection's order, and each platform's steps, from the same strings as the release page.
- If the owner's paste test works, "Copy for Spotify" (the collection's `spotify:local:` URIs, Mac) becomes its own issue.

## Security and privacy

- **Collection names** are new synced user text. They are length-capped, stored as JSON, and only ever rendered as text
  (React and SwiftUI escaping; never inserted as HTML).
- **Every route** is scoped to the token's user and joins the cross-user matrix.
- **The Mac's local routes** keep the loopback and origin checks. Ids are validated UUIDs, and no file path comes from a collection.
- **Nothing new leaves the device** except collection records. There are no new files, no new Spotify scope and no new secrets.
- **Abuse:** the caps on collections, items and body size bound what one account can store.

## Rollout (each an issue with a session brief, made with `/breakdown 339` once this plan is approved)

1. **Spec and API.** The `spec/sync.md` section, the table and routes, the release-tombstone prune, shared fixtures in
   `spec/fixtures/collections/`, and the cross-user matrix. It ships an additive migration, so the owner reviews it.
2. **Mac: collections without the record player.** The store, sync, local routes, the Library row, the Collections page in
   List view with the queue, adding, editing, and playing through #338's queue. Blocked by 1 (and #338 for playing).
3. **iPhone: the same.** Blocked by 1 and #337 (the generalised queue).
4. **Mac: the record player view.** The wheel, the turntable and the motion budget, with `docs/design.md`. A Codex design
   review before merge. Blocked by 2.
5. **iPhone: the record player view.** A Codex design review before merge. Blocked by 3 and 4.
6. **Both: the "Make it a playlist" guide for collections.** Small. Blocked by 2 and 3.

**Later, not in this plan:** rules, a chosen cover, Tape and the pocket player as other objects on the wheel, sharing a
collection (#146), and "Copy for Spotify" if the paste test passes.

## Tests

- **API:**
  - Put, pull and delete, with paging (`hasMore`, `nextVersion`) and last writer wins.
  - A release deleted in the same moment as a collection `PUT` that names it: the stored record never keeps the item, and the
    reply's `pruned` says so.
  - An item of an unknown `kind` survives a round trip unchanged; a malformed `release` or `track` item is a 400.
  - 400s for a bad name, too many items, a duplicate item or a bad `kind` shape.
  - The per-user cap.
  - The prune on a release tombstone, and a `PUT` that names a tombstoned release.
  - The cross-user 404s, and account deletion.
- **Shared fixtures** (every app runs them):
  - a valid record;
  - an item whose release lacks that track (hidden, never a failed page);
  - an item with an unknown `kind` (skipped on the page and when playing, kept on re-push);
  - a malformed known item (refused by the API; a client never writes one).
- **Mac:**
  - Atomic store writes, and sync order (releases before collections).
  - Building the queue (disc order, skipping what can't play).
  - The routes, including 403 in the demo.
  - Adding, reordering with the keyboard, the wheel's keys, and Reduce Motion.
- **iPhone:**
  - The model and outbox, building the queue, and the wheel's adjustable action.
  - Reordering with the VoiceOver actions.
  - UI tests for adding, reordering and playing.
