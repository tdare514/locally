# #193: plays by day (so "today / this week / this month" can be real)

## Why

The Streams page (#145, draft PR #192) and the stats sidebar (#154, draft PR #177) both open on periods:
- "your top 5 this week"
- "this month"
- "this week against last"
- "last played 38 min ago"

The play-count system can't answer any of these today:
- **Mac** `plays.json`: `{trackId: {releaseId, count, pushed}}`, one running total per track.
- **API** `play_counts(user_id, device_id, release_id, track_id, count, updated_at)`, primary key
  (device, track). `count` is absolute and merged as max(stored, sent). `updated_at` is the last push
  time, overwritten and never returned.
- **Reads:** `GET /v1/releases/:id/plays` is per release, with the total and per-device counts.

There's no timestamp or history anywhere, only all-time totals.

## Decisions this plan proposes (owner to approve)

1. **Granularity: per day.** "Today", week, month and "last played" (to the day) all fall out of day
   buckets. Per-play timestamps aren't needed and would be a more personal record.
2. **The Mac records the day.** It's the only device that counts plays (#103: the iPhone can't). When the
   tracker counts a play (30 s or 90% rule, #106), it increments the all-time count **and** a day bucket
   `YYYY-MM-DD` in the Mac's **local time zone at play time**.
3. **The server keeps day buckets per device.** New table:
   ```
   play_days(user_id, device_id, release_id, track_id, day TEXT 'YYYY-MM-DD', count INT, updated_at,
             PRIMARY KEY (device_id, track_id, day))
   ```
   Pushes stay **absolute and idempotent**: `PUT /v1/plays` gains an optional `days: [{day, count}]` per
   entry, merged per (device, track, day) as max(stored, sent), the same rule as today. Old clients send
   no `days` and keep working.
4. **One library-wide read:** `GET /v1/plays/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` returns, for the
   caller's live releases:
   ```json
   { "tracks": [{ "trackId", "releaseId", "plays", "lastPlayedDay" }], "allTime": [{ "trackId", "releaseId", "plays" }] }
   ```
   - Totals sum over devices, after the #175 same-Mac fix, so there's no double counting.
   - The client groups by album (release) and artist using its own library.
   - Ranges are capped at 400 days, and the response is paged if a library is huge.
5. **Back-fill:** existing all-time counts have no dates. They stay in `play_counts` and count toward
   **All time** only. "This week" starts empty on upgrade. The UI says so once ("Weekly stats start
   today").
6. **Retention: 400 days** of day buckets, enough for "this month last year" later. The daily cron
   deletes older rows. All-time totals are kept.
7. **Privacy:**
   - A daily listening history is more personal than a total. It's the user's own data, visible only to
     them, never shared and never used for anything else.
   - Account deletion and the existing tombstone cleanup remove `play_days` too.
   - It's added to the #36 privacy text: "Locally keeps how many times you played each of your tracks
     per day, for up to 400 days, to show your weekly and monthly stats."
   - Play counting stays opt-in (#106/#110).

## Time zones

- Days are local to the Mac at play time and stored as plain dates. A user who travels may see a play
  land on "yesterday". That's acceptable and matches how people think about "today".
- The server never converts. `from` and `to` are the client's local dates.

## Contract and compatibility

- `spec/sync.md` "Play counts": the optional `days` on push, the new `play_days` merge rule, and the
  summary endpoint.
- Old Mac builds push no `days`, so their plays count toward all-time only. No breakage.
- The iPhone reads totals as today. The Streams page on iPhone (after #160 and #145) uses the summary.

## Security

- The summary endpoint is device-token auth, scoped by `user_id`, and live releases only. It's added to
  the cross-user matrix (#33).
- The `day` field is validated as a real calendar date within the last 400 days, up to tomorrow (to allow
  for clock skew). Day counts are bounded the same way as counts today (≤ 1,000,000).
- Rate limit: the summary endpoint uses the shared limiter, at 60/hour/user.

## Speed

- One indexed range query for the summary: an index on `(user_id, day)`.
- The Mac keeps day buckets in `plays.json`, at about 30 bytes per (track, day) played. A heavy listener
  playing 100 tracks a day for 400 days is about 1.2 MB, which is fine. The file compacts at the
  retention window.
- Pushes send only the days changed since the last push, tracked by a per-day pushed marker, as for
  totals.

## Rollout (each an issue with a session brief)

1. **API:** `play_days` and its migration, the `days` merge on `PUT /v1/plays`, the summary endpoint,
   cleanup, the cross-user tests. **Owner reviews before merge.**
2. **Mac:** record day buckets, push them, and read the summary for the Streams page and the sidebar
   widgets.
3. **Streams page build:** the direction picked in #192, then the sidebar picked in #177.
4. **iPhone Streams page:** the #160 language.

## Tests

- **API:**
  - The day merge is max per (device, track, day).
  - Summary sums across devices for a range, with `lastPlayedDay` correct.
  - Tombstoned releases are excluded, and the cross-user matrix passes.
  - Retention cleanup, plus validation of bad dates and future days.
- **Mac:**
  - A counted play increments today's bucket in the local zone (fake clock and zone).
  - Pushes send only changed days.
  - Sign-out resets the pushed markers.
  - The summary is grouped into album and artist correctly.
