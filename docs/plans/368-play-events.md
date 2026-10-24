# #368: Play events, when each play happened

## What the owner wants (24 Oct)

> "track when exactly a song was played … let's get this now … new API contract as well. I don't care about it being only 5 users."

Today a play is a count: an absolute lifetime count per (device, track, source), plus a count per local day
(`spec/sync.md`, "Play counts", "Source (#340)", "Day buckets"). Nobody knows the time of day a song was
played or how long it was listened to. This plan adds a **play event** for every counted play: its start
time, how long it was heard, its source and its device. Counts stay exactly as they are.

What events make possible:
- **"Last played":** "Today at 21:14" instead of "Today", in Stats and on the song page (#365).
- **Minutes:** real listening minutes. #367 estimates them as plays × length; events replace the estimate wherever they exist.
- **History:** a timeline of recent plays.
- **Time-of-day:** time-of-day patterns, later.

## Principles

1. **Additive.** Counts, day buckets, `PUT /v1/plays` and every shipped client keep working unchanged.
   The server never derives counts from events, and events never change counts, so nothing is counted twice.
2. **One event per counted play.** A client that supports events writes the event at the same moment it adds
   1 to its count, under the same rule (min(30 s, 90% of the track), once per session; a jump back of more
   than 3 s starts a new session). So, from that point on, events and counts agree.
3. **Idempotent and monotonic, like counts.**
   - A client-generated event id makes every retry safe.
   - `listenedMs` only grows: `max(stored, sent)`.
   - The other fields are fixed by the first write.
4. **Personal data.** Exact listening times are more revealing than counts. They are readable only by the
   account, kept 400 days like day buckets, deleted with the account at once, and deleted with a release on
   its tombstone schedule.

## Contract (`spec/sync.md` gets a "Play events (#368)" section; `apps/api`)

### `PUT /v1/plays/events`: push events (device token)

```jsonc
{ "events": [
  { "id": "uuid",            // client-generated, v4; unique per account
    "releaseId": "uuid",
    "trackId": "uuid",
    "source": "locally",     // "spotify" | "locally"; required here (no legacy default)
    "startedAt": 1792841234567, // epoch milliseconds (integer), when this play's session began
    "day": "2026-10-24",     // the client's local date of startedAt, strict YYYY-MM-DD; never converted
    "listenedMs": 214000 }   // integer 0..86_400_000, audible time in this session so far
] }
```

- **Strict body.** An unknown key at any level is a 400, and so is `deviceId`: the device is always the token's.
- **Batches:** 1 to 500 events per request.
- **`startedAt`:**
  - later than server now + 24 h: the whole request is a 400 (clock skew);
  - older than 400 days: that event is silently dropped, as days are;
  - not a 400 for being in the past.
- **`day`:** a real date (2026-02-30 is a 400), not after UTC tomorrow (the day bucket rule).
- **Upsert per (account, id)** (`deviceId` below means the stored event's device; `device` means the token's):
  - A new id inserts.
  - A known id with the same `deviceId` updates only `listenedMs = max(stored, sent)` and `updatedAt`.
  - A known id from another device, or one with different fixed fields, changes nothing and is counted in `ignored`.
- **Releases:** an event whose `releaseId` is not a live release of this account is counted in `ignored`
  (same rule as counts); `trackId` is not checked against the record.
- **Reply:** `{ "accepted": number, "ignored": number }`, both integers ≥ 0.
- **Rate limit:** `playEvents`, 120 requests an hour per user, then 429. `PUT /v1/plays` has none today
  (survey); that is noted for the API issue, not changed here.

### `GET /v1/plays/events?from=<ms>&to=<ms>[&cursor=<string>]`: read history (device token)

- **Window:** `from` and `to` are epoch ms integers with `from <= to` and `to - from <= 400 days`. Matches
  `from <= startedAt < to`.
- **Reply:**
  ```jsonc
  { "events": [
      { "id": "uuid", "releaseId": "uuid", "trackId": "uuid", "source": "spotify" | "locally",
        "startedAt": number /* epoch ms */, "day": "YYYY-MM-DD", "listenedMs": number,
        "device": { "id": "uuid", "name": "string", "platform": "string", "current": boolean } } ],
    "nextCursor": "string" | null }
  ```
- **Order and paging:** newest first (`startedAt` desc, then `id`), at most 500 per page. The cursor is opaque.
- **Releases:** events of tombstoned releases are never served.
- **Rate limit:** `playsSummary`, shared with the summary.

### `GET /v1/plays/summary`: three additive fields (no change for shipped clients)

Each `tracks[]` entry gains:
- `lastPlayedAt`: number (epoch ms) | null. The latest `startedAt` among the track's events whose `day` is
  in the window; null when it has none.
- `listenedMs`: number. The sum of those events' `listenedMs`.
- `events`: number. How many there are.

Each `allTime[]` entry gains the same three fields over all retained events.

Shipped clients ignore them: the Mac's `ServerPlaysSummaryPageSchema` is a plain `z.object` that strips
unknown keys (`apps/web/src/server/plays/playsWire.ts:80`), and iOS `Codable` ignores unknown keys.

**Minutes for a track over a window:** `listenedMs / 60000 + max(0, plays - events) × length`. That is real
time where events exist and the #367 estimate for older plays. Albums and artists sum their tracks. The
number is shown as plain minutes, with no "about" marker for the estimated part.

Also for the API issue: `spec/sync.md` says the summary allows 60 requests an hour per user, but the code
allows 600 (`apps/api/src/server/container.ts:135`). The spec line gets corrected in the same change.

### Spotify plays counted in the cloud (`SpotifySampler`)

The sampler already adds 1 to `play_counts` and `play_days` at the moment it counts
(`apps/api/src/server/spotify/SpotifySampler.ts:186-243`, `CloudPlayCounter.ts`).
- **The event.** In the same transaction, it inserts an event:
  - `source: "spotify"`, on the "Spotify (online)" cloud device;
  - `startedAt` = the counting sample's time − its `progress_ms`;
  - `day` from the account's linked time zone, as for `play_days`;
  - `listenedMs` = `progress_ms`.
- **The event id is deterministic.** It is a UUID v5 of (userId, trackId, session start), so a retried run
  after a lost lease writes the same row.
- **Later samples in the same session** raise `listenedMs`. To bound writes, they update only when it has
  grown by 30 s or more, or when the session ends.
- **The Mac's Spotify tracker** (`PlayTracker.ts`) stands down while the cloud is linked (#305–#307), so it
  writes events only when it would write counts.

### Migration (owner reviews it before merge)

`apps/api/drizzle/0013_<name>.sql`, generated by `npm run db:generate`. It is additive and compatible with the
previous deployment's code (`apps/api/AGENTS.md`).

```sql
CREATE TABLE play_events (
  user_id text NOT NULL, id text NOT NULL, device_id text NOT NULL,
  release_id text NOT NULL, track_id text NOT NULL, source text NOT NULL,
  started_at integer NOT NULL, day text NOT NULL, listened_ms integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL, updated_at integer NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX play_events_user_started_idx ON play_events (user_id, started_at);
CREATE INDEX play_events_user_release_idx ON play_events (user_id, release_id);
CREATE INDEX play_events_user_day_idx ON play_events (user_id, day);
-- and the same AFTER DELETE ON users trigger that 0004/0011 add for play_days
```

The primary key is per account. One account can't touch another account's events by guessing an id, so a
collision across accounts is harmless.

### Deletion and retention

- **`CleanupService`** (daily cron):
  - deletes events of releases tombstoned 30+ days ago;
  - deletes events whose `started_at` is older than 400 days;
  - does both in rowid pages, like `deletePlayDaysPaged`.
- **`AccountService.delete`** removes the user's events in its transaction, with the trigger as a backstop.
- **Shares (#183)** never expose plays or events.

## Clients

### iPhone (`apps/ios`)

- **`PlayEventStore`** (new, file-backed like `FilePlayCountStore`: `play-events.json` in Application Support).
  - Each event holds `id`, `releaseId`, `trackId`, `startedAt`, `day`, `listenedMs` and `pushedListenedMs`
    (nil until first pushed).
  - It is capped at 20,000 events, dropping the oldest pushed ones first, and pruned past 400 days.
- **`PlaybackService` / `PlayCounter`.**
  - At the count point (`PlaybackService.swift:540`, next to `playCounts.increment`), it appends an event with
    the session's start time.
  - It updates `listenedMs` on pause, finish, skip, stop and app background.
  - The audible time excludes paused time and seeks.
- **`SyncEngine.pushPlayEvents()`** runs right after `pushPlays()` in each reconcile.
  - It sends batches of 500 where `pushedListenedMs` is nil or less than `listenedMs`, then marks them pushed.
  - A 429 or a failure leaves them pending.
- **Stats and the song page.**
  - "Last played" uses `lastPlayedAt` when present ("Today at 21:14", "Yesterday at 09:02", "12 Oct at 18:30",
    in the device's locale and time zone), else today's day-level label.
  - Minutes use the formula above.
- **History (new screen, designed first):** a timeline of recent plays from `GET /v1/plays/events`.
  - Each play shows its cover sleeve, the time, and the device it was played on.
  - Plays are grouped by day.
  - It lives in the immersive look; the owner picks from variants before the build.

### Mac (`apps/web`)

- **`FilePlayEventStore`** (new, beside `FilePlayCountStore`), the same fields and rules.
- **Plays in the Locally player:**
  - `app/api/plays/locally/route.ts` takes `startedAt` and `listenedMs` from the in-app player, and the
    renderer's player reports them at the count point and on pause, finish or skip.
  - It writes nothing when the `trackPlays` setting is off.
- **Spotify on the Mac:** `PlayTracker.ts` writes an event at its count point and updates `listenedMs` from
  the samples. It writes nothing while the cloud is linked (it already stands down).
- **Push:** in the sync cycle after the plays push, with the same batching.
- **Stats:** the same "last played" and minutes rules; History on the Mac follows the iPhone design.

## Security and privacy

- **Authentication.** Events are only ever read and written with the account's device token. There is no
  cross-account read path. The cross-user test matrix (#33) gains both new routes, returning 404 or empty for
  another account.
- **No new personal fields.** Events add no new identifiers; the device is the existing device row.
- **The privacy policy (#36, still an owner decision) must say:**
  - that Locally keeps the time and length of each play for 400 days;
  - that deleting the account deletes them at once.
- **Clock skew** only misplaces a user's own history; the 24 h future bound keeps garbage out.

## Rollout (each an issue with a session brief, by `/breakdown 368` once this plan is approved)

1. **Spec + API:**
   - the `spec/sync.md` section and shared fixtures in `spec/fixtures/play-events/` (valid and `invalid-*`);
   - migration 0013 (the owner reviews it);
   - both routes, the summary fields, sampler events, cleanup, account deletion and the rate limit.
2. **iPhone, record and push:** the store, `PlaybackService` events, the sync push, and "last played" with
   time and minutes in Stats.
3. **Mac, record and push:** the same.
4. **iPhone History:** variants first (the owner picks), then the build.
5. **Mac History:** matching the chosen design.

Steps 2 and 3 can run in parallel once step 1 is deployed; 4 and 5 follow. It is built and tested now. The
public rollout is gated on the owner's user threshold, which is a separate decision.

## Tests

- **API:**
  - strict body, with unknown keys and `deviceId` a 400;
  - the bounds on `startedAt`, `day`, `listenedMs` and batch size;
  - an old `startedAt` silently dropped;
  - a re-push is idempotent, `listenedMs` only grows, and fixed fields can't change;
  - another device's id is ignored;
  - a tombstoned release's events are ignored;
  - two accounts with the same event id stay separate;
  - the summary fields and the minutes inputs over a window;
  - events paging, order and window limits;
  - cleanup deletes both the tombstoned and the over-400-day events;
  - account deletion removes them all;
  - the rate limit gives 429;
  - the cross-user matrix;
  - sampler events: one per counted play, the deterministic id across a lease retry, `listenedMs` throttled.
- **Each client:**
  - store append, update, prune and pending selection;
  - an event at the count point with the session start;
  - `listenedMs` that excludes paused time;
  - push batching and marking;
  - "last played" formatting;
  - the minutes formula;
  - a literal server reply from `spec/fixtures/play-events/` parsed through the real HTTP client, not a fake.
    That one is mandatory: see #314, where a fake hid a type mismatch.
