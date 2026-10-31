# What stats people want (#424)

Research, 30 Oct 2026, for issue #424. The owner finds the Stats pages cartoonish: the medal sleeve fan on the Mac and the medal discs on the iPhone. He wants a consistent set of chosen stats that the user can customise, as stats.fm does. This note records what stats.fm, Spotify, Apple Music Replay and Last.fm show and what their users ask for, then maps that to the play events in #368 (`docs/plans/368-play-events.md`, `spec/sync.md`).

Reddit could not be read: reddit.com and old.reddit.com refuse automated fetches, and a Redlib mirror returned 403. One r/truespotify thread was read through a public snapshot; the stats.fm feature board, Spotify Community, Apple Community, Tildes and Hacker News stand in for the rest, and the board's vote counts are the best measure of demand found.

## 1. Summary

People want ranked top tracks, artists and albums with real play counts and total minutes, over a period they choose, and they want the numbers right: the loudest complaint about Wrapped and Replay is counts that don't match what people played ([Spotify Community](https://community.spotify.com/t5/Your-Library/My-Wrapped-content-is-inaccurate/td-p/7242372), [Apple Community](https://discussions.apple.com/thread/256210755)). Beyond the basics, the most-voted requests on the [stats.fm board](https://statsfm.featurebase.app/?sortBy=upvotes:desc) are about time and memory: favourites, merged duplicates, streaks, milestones, "on this day" and decades. The packaging that wins is a stable, plain report with a period switch, plus an occasional story for sharing. stats.fm users choose the period, the sort and the timeframe, not the layout, and a change to its home screen drew about 250 votes against it. Locally's summary plus #368 covers most of the catalogue within 400 days; skips, an exact listening clock, track artists and anything older than that need small contract changes.

## 2. Sources

| Source | What it is | Link | Read (2026) |
|---|---|---|---|
| stats.fm for Spotify | App Store listing, v2.13.0 | [apps.apple.com](https://apps.apple.com/us/app/stats-fm-for-spotify-music-app/id1526912392) | 30 Oct |
| stats.fm Plus | Free against Plus | [stats.fm/plus](https://stats.fm/plus) | 30 Oct |
| stats.fm for Apple Music | App Store listing, Sep 2025 | [apps.apple.com](https://apps.apple.com/us/app/stats-fm-for-apple-music/id6746327242) | 30 Oct |
| stats.fm board | Featurebase requests by votes | [statsfm.featurebase.app](https://statsfm.featurebase.app/?sortBy=upvotes:desc) | 30 Oct |
| stats.fm old board | Canny feedback | [feedback.stats.fm](https://feedback.stats.fm/) | 30 Oct |
| stats.fm import guide | Help page | [support.spotistats.app](https://support.spotistats.app/docs/import/spotify-import) | 30 Oct |
| Make Tech Easier | stats.fm walkthrough, Nov 2025 | [maketecheasier.com](https://maketecheasier.com/stats-fm-advanced-spotify-stats/) | 30 Oct |
| iMore | stats.fm review, Apr 2024 | [imore.com](https://www.imore.com/ios/this-clever-app-gives-me-spotify-wrapped-stats-all-year-round) | 30 Oct |
| Spotify | Listening Stats, 6 Nov 2025 | [newsroom](https://newsroom.spotify.com/2025-11-06/spotify-new-feature-listening-stats/) | 30 Oct |
| Spotify | Wrapped 2025, 3 Dec 2025 | [newsroom](https://newsroom.spotify.com/2025-12-03/2025-wrapped-user-experience/) | 30 Oct |
| Spotify | How Wrapped is made, 3 Dec 2025 | [newsroom](https://newsroom.spotify.com/2025-12-03/how-your-wrapped-is-made/) | 30 Oct |
| Spotify | Spotify 20, 12 May 2026 | [newsroom](https://newsroom.spotify.com/2026-05-12/spotify-20-personal-music-retrospective/) | 30 Oct |
| Spotify Community | Accuracy thread; total plays and skip ideas (search excerpts) | [1](https://community.spotify.com/t5/Your-Library/My-Wrapped-content-is-inaccurate/td-p/7242372), [2](https://community.spotify.com/t5/Implemented-Ideas/Display-total-historical-plays/idi-p/2229/page/2), [3](https://community.spotify.com/t5/Live-Ideas/Allow-user-to-view-personal-quot-skip-count-quot-of-songs-in-our/idc-p/5641688) | 30 Oct |
| r/truespotify | Minutes and plays thread | [snapshot](https://reddit.sentinel-team.org/posts/1sub9i5/snapshots/2026-04-24T10%3A38%3A50.115821Z) | 30 Oct |
| Tildes | Wrapped thread, Dec 2025 | [tildes.net](https://tildes.net/~music/1rjh/) | 30 Oct |
| SlashGear | Wrapped accuracy, Dec 2025 | [slashgear.com](https://www.slashgear.com/2054958/suspicious-spotify-wrapped-you-should-be) | 30 Oct |
| Apple Support | Replay help | [support.apple.com](https://support.apple.com/en-gb/109356) | 30 Oct |
| MacStories | Replay 2025, Dec 2025 | [macstories.net](https://www.macstories.net/linked/apple-musics-replay-2025-is-live/) | 30 Oct |
| Engadget | Replay 2025, Dec 2025 | [engadget.com](https://www.engadget.com/entertainment/music/apple-music-replay-2025-is-here-to-highlight-your-unimpeachable-music-taste-151224318.html) | 30 Oct |
| Apple Community | Replay accuracy threads | [1](https://discussions.apple.com/thread/256210755), [2](https://discussions.apple.com/thread/255870496), [3](https://discussions.apple.com/thread/255514118) | 30 Oct |
| Kirkville | Replay against library counts | [kirkville.com](https://kirkville.com/apple-music-replay-provides-a-summary-of-your-music-listening-or-does-it/) | 30 Oct |
| MacStories | Replay against Last.fm, Nov 2023 | [macstories.net](https://www.macstories.net/news/apple-music-replay-is-out-but-for-a-deeper-look-at-your-music-habits-try-last-fm/) | 30 Oct |
| Last.fm | Last.week launch, Feb 2017 | [last.fm](https://www.last.fm/features/post/48430472:feature:01d9cdab-96d2-4127-9a3f-f2fbc0ea0ea6) | 30 Oct |
| Last.fm Pro | Subscription page | [last.fm/pro](https://www.last.fm/pro) | 30 Oct |
| Last.fm app | App Store listing | [apps.apple.com](https://apps.apple.com/us/app/last-fm/id1188681944) | 30 Oct |
| Hacker News | Last.fm independence thread | [hn.svelte.dev](https://hn.svelte.dev/item/48295892) | 30 Oct |
| Mobbin | Eight screens, two flows | Section 5 | 30 Oct |

## 3. The stats catalogue

Ranked by how often each stat is shown or asked for. F is stats.fm, S Spotify, A Apple Music Replay, L Last.fm (sources in section 5). Votes are from the [stats.fm board](https://statsfm.featurebase.app/?sortBy=upvotes:desc). Field names are from `spec/sync.md` and #368.

| # | Stat | Shown by | Demand | Needs | Locally |
|---|---|---|---|---|---|
| 1 | Top tracks | F S A L | High | Plays per track | Yes: `tracks[].plays` |
| 2 | Top artists | F S A L | High | Plays by artist | Yes: release `artist` only |
| 3 | Top albums | F S A L | High: new in [Wrapped 2025](https://newsroom.spotify.com/2025-12-03/2025-wrapped-user-experience/) | Plays by release | Yes: `releaseId`, `kind` |
| 4 | Total minutes | F S A | High: Wrapped's headline | Audible time | Yes with #368: `listenedMs`, estimated before events |
| 5 | Play count per item | F S A L | High: accuracy complaints | Period and lifetime counts | Yes: `plays`, `allTime[].plays` |
| 6 | Period choice | F S A L | High | Dated counts | Yes: `from`/`to`, `days[]`, 400 days |
| 7 | Favourites | Asked on F | High: 1.5k votes | A user's pick | Client setting, no data needed |
| 8 | Merge duplicates | Asked on F | High: 1.4k, 909 votes | Single, album and deluxe linked | Partly: no single-to-album link |
| 9 | Daily streak | Asked on F | High: [973](https://statsfm.featurebase.app/p/daily-streak) | Days played | Yes with #368: event `day` |
| 10 | Milestones | S A; asked on F | High: [801](https://statsfm.featurebase.app/p/notifications-for-milestones) | Running totals | Yes: `allTime`; minutes partly |
| 11 | Last played | F L | Medium | Last play time | Yes: `lastPlayedDay`, `lastPlayedAt` |
| 12 | Listening history | F L | Medium | One row per play | Yes with #368: `GET /v1/plays/events` |
| 13 | Top genres | F S A | Medium | Genre per play | Partly: release `genre`, often null |
| 14 | Against last period | L A | Medium | Two periods | Yes: two summary calls |
| 15 | On this day | S; asked on F | Medium: [545](https://statsfm.featurebase.app/p/on-this-day-feature-memories) | Plays a year back | Partly: 400 days reaches one year |
| 16 | Decades | L; asked on F | Medium: [470](https://statsfm.featurebase.app/p/decade-graph) | Release year | Yes: `year`, `releaseDate` |
| 17 | New discoveries | S A | Medium | First play date | Partly: within 400 days |
| 18 | Listening clock | F L | Medium | Local hour | Partly: `startedAt` is UTC, no offset |
| 19 | Skips | Asked on S, F | Medium | Early stops | No: events start at the count point |
| 20 | Rank movement | S | Low | Monthly ranks | Yes: a summary call a month |
| 21 | Completion | Brink | Low | Heard against length | Partly: `listenedMs`, `durationSec`, counted plays |
| 22 | By device or source | Locally | Low | Device, source | Yes: `devicePlays`, `bySource`, `device` |
| 23 | Top listener, friends | F S A | High on F: 913 | Other people's plays | No: shares never expose plays (#183) |

## 4. What people ask for or complain about

- **Wrong counts.** Spotify users report Wrapped counts that are too low and don't match stats.fm ([Spotify Community](https://community.spotify.com/t5/Your-Library/My-Wrapped-content-is-inaccurate/td-p/7242372)). One Tildes user saw 92 plays in stats.fm against 80 in Wrapped ([Tildes](https://tildes.net/~music/1rjh/)).
  - Apple users report wrong top songs and low counts ([Apple](https://discussions.apple.com/thread/256210755)), and wrong album stats ([1](https://discussions.apple.com/thread/255870496), [2](https://discussions.apple.com/thread/255514118)).
  - Kirkville found that Replay did not match his library's counts ([Kirkville](https://kirkville.com/apple-music-replay-provides-a-summary-of-your-music-listening-or-does-it/)).
- **The year ends early.** Wrapped's data stops in mid-November ([Spotify](https://newsroom.spotify.com/2025-12-03/how-your-wrapped-is-made/)), and users notice ([Tildes](https://tildes.net/~music/1rjh/), [SlashGear](https://www.slashgear.com/2054958/suspicious-spotify-wrapped-you-should-be)).
- **Personal all-time counts.** Spotify marked a total-plays idea implemented, but it shipped global counts, not personal ones ([Spotify Community](https://community.spotify.com/t5/Implemented-Ideas/Display-total-historical-plays/idi-p/2229/page/2)). The first personal all-time view came with Spotify 20 ([Spotify](https://newsroom.spotify.com/2026-05-12/spotify-20-personal-music-retrospective/)).
- **Minutes and plays.** An r/truespotify thread asks how the two are counted ([snapshot](https://reddit.sentinel-team.org/posts/1sub9i5/snapshots/2026-04-24T10%3A38%3A50.115821Z)). Spotify counts actual time, so a song at 2x speed counts half ([Spotify](https://newsroom.spotify.com/2025-12-03/how-your-wrapped-is-made/)).
- **Skips.** Spotify users ask for a personal skip count ([Spotify Community](https://community.spotify.com/t5/Live-Ideas/Allow-user-to-view-personal-quot-skip-count-quot-of-songs-in-our/idc-p/5641688)). On stats.fm, skips counted as streams is a recurring bug report ([board](https://statsfm.featurebase.app/?q=skip)).
- **Favourites and merges lead.** On the [board](https://statsfm.featurebase.app/?sortBy=upvotes:desc), favourites have 1.5k votes, merging singles into albums 1.4k, and merging tracks, albums and artists 909.
- **Time and memory.** Further down the board come a daily streak ([973](https://statsfm.featurebase.app/p/daily-streak)) and milestone alerts every 100 or 1,000 streams or minutes ([801](https://statsfm.featurebase.app/p/notifications-for-milestones)). "On this day" has [545](https://statsfm.featurebase.app/p/on-this-day-feature-memories) votes and a decade graph [470](https://statsfm.featurebase.app/p/decade-graph).
- **Leave the home screen alone.** stats.fm redesigned its home screen in October 2024, and two "bring back the old home screen" posts drew 145 and 75 votes ([1](https://statsfm.featurebase.app/p/nah-pls-bring-the-old-home-screen-back-what-is), [2](https://statsfm.featurebase.app/p/bring-back-old-home-screen)), with a third at 30.
  - One post said "i dont think you should add more customization" ([post](https://statsfm.featurebase.app/p/new-home-screen)).
  - Requests to customise home or hide graphs drew 2 votes and 1 ([1](https://statsfm.featurebase.app/p/customizable-homescreen), [2](https://statsfm.featurebase.app/p/customize-artist-track-album-and-home-pages)).
- **Widgets.** Android widgets have 302 votes ([post](https://feedback.stats.fm/p/android-widgets-3)).
- **Change over time.** MacStories wanted Replay to show change over time and new artists, and pointed to Last.fm ([MacStories](https://www.macstories.net/news/apple-music-replay-is-out-but-for-a-deeper-look-at-your-music-habits-try-last-fm/)).
  - Hacker News readers value Last.fm for history back to 2005, playtime and export ([HN](https://hn.svelte.dev/item/48295892)).
  - A Tildes user calls Last.fm "one of the last bastions of the old internet" ([Tildes](https://tildes.net/~music/1rjh/)).
- **Waiting.** stats.fm's lifetime stats need a Spotify export that can take weeks ([iMore](https://www.imore.com/ios/this-clever-app-gives-me-spotify-wrapped-stats-all-year-round), [guide](https://support.spotistats.app/docs/import/spotify-import)).

## 5. Packaging patterns

**stats.fm.**
- Home shows recently played, recap cards, and four weeks of top artists, tracks and genres ([Make Tech Easier](https://maketecheasier.com/stats-fm-advanced-spotify-stats/)).
- Top lists cover 4 weeks, 6 months or a year. Plus adds lifetime, custom ranges, play counts and listening clocks ([stats.fm Plus](https://stats.fm/plus)).
- Each item has a page with plays, minutes and top listeners ([App Store](https://apps.apple.com/us/app/stats-fm-for-spotify-music-app/id1526912392)).
- Weekly and monthly recaps arrive as cards ([App Store](https://apps.apple.com/us/app/stats-fm-for-apple-music/id6746327242)), and share cards can be styled ([Make Tech Easier](https://maketecheasier.com/stats-fm-advanced-spotify-stats/)).
- Users customise period, sort and timeframe; the page is fixed. Not on Mobbin.

**Spotify.** Spotify has two layers.
- **Listening Stats** sits in the profile menu. It shows four weeks of top artists and songs, one highlight and a share button ([Spotify](https://newsroom.spotify.com/2025-11-06/spotify-new-feature-listening-stats/), [Mobbin](https://mobbin.com/screens/f3743197-453a-4ee5-a134-83305631c6ad)).
- **Wrapped** is a yearly story with a share card per chapter ([Spotify](https://newsroom.spotify.com/2025-12-03/2025-wrapped-user-experience/)).
  - Its summary lists the top five artists and songs as plain numerals ([flow](https://mobbin.com/flows/3a08d9f8-11f6-480b-8ea9-958f0fc65108)).
  - Top albums are a numbered list ([screen](https://mobbin.com/screens/ea41e56b-60ff-4986-ac45-a3b19c903fee)).
  - It ends in a playlist ([screen](https://mobbin.com/screens/ee321983-3766-43e9-9cec-6660a030daf2)).
  - Clubs ([screen](https://mobbin.com/screens/f60bcad3-96c3-4780-950f-9fab3a1e8410)) and the minutes card ([flow](https://mobbin.com/flows/12ddff8c-766e-4762-bceb-6edd93ba57a2)) lean on novelty.
- **Spotify 20** reused the story form for an all-time look back ([Spotify](https://newsroom.spotify.com/2026-05-12/spotify-20-personal-music-retrospective/)).

**Apple Music Replay.**
- Replay lives on Home as "Replay: Your Top Music" and on the web ([Apple](https://support.apple.com/en-gb/109356)).
- It has monthly insights, a yearly highlight reel, milestones and playlists, ranked by plays and time ([Apple](https://support.apple.com/en-gb/109356), [Engadget](https://www.engadget.com/entertainment/music/apple-music-replay-2025-is-here-to-highlight-your-unimpeachable-music-taste-151224318.html), [MacStories](https://www.macstories.net/linked/apple-musics-replay-2025-is-live/)).
- Replay is not on Mobbin; Apple's Top 100 widget shows its rank style, a plain numbered list ([screen](https://mobbin.com/screens/d9af8eb6-f6ae-4080-b64e-8ba339c300f1)).

**Last.fm.**
- Charts run from 7 days to all time ([App Store](https://apps.apple.com/us/app/last-fm/id1188681944)).
- A Friday report compares the week with earlier weeks ([Last.fm](https://www.last.fm/features/post/48430472:feature:01d9cdab-96d2-4127-9a3f-f2fbc0ea0ea6)).
- Pro adds monthly and historical reports ([Last.fm Pro](https://www.last.fm/pro)).
- Public report pages, seen through search but not linked because they belong to individuals, add an hourly clock and decades.
- Last.fm is not on Mobbin.

**Quiet reports outside music.**
- Brink switches between This year and All time. It shows time listened, a streak heatmap and a top list with bars ([screen](https://mobbin.com/screens/25b055b2-386f-463e-943c-099849dd5f03)).
- SoundCloud Insights opens on plays today, hourly bars and top cards ([screen](https://mobbin.com/screens/89ce634e-f465-421a-a97c-be277f9e5ead)).
- Square's report cards each carry their own period stepper, the model for a card library ([screen](https://mobbin.com/screens/7686972f-78b5-4316-a692-d0f0e411877c)).

**The pattern.** Every product has a fixed report with a period switch, plus a seasonal story for sharing. Customisation means time range and sort.

## 6. What Locally's play events can and can't support

Fields are from `spec/sync.md` and `docs/plans/368-play-events.md`.

**Today's summary.**
- `GET /v1/plays/summary?from&to` returns `plays`, `devicePlays`, `lastPlayedDay` and `bySource` per track.
- Its `allTime` counts are kept forever.
- Grouped by the release record's `releaseId`, `artist`, `kind`, `year`, `releaseDate` and `genre`, it covers rows 1 to 3, 5, 6, 10, 13, 14, 16, 20 and 22 within 400 days.

**#368 adds:**
- `lastPlayedAt`, `listenedMs` and `events` on both lists;
- `GET /v1/plays/events`, newest first, 500 a page, with `device`;
- minutes as `listenedMs / 60000 + max(0, plays - events) × length`;
- history, streaks, on this day and first plays;
- completion, as `listenedMs` against `durationSec`.

Together these cover rows 4, 9, 11, 12, 15, 17 and 21.

**Gaps:**
- **Skips.** Events are written only at the count point (min(30 s, 90%)), so earlier stops leave no record. A skip event that the summary excludes from counts would add them without breaking existing clients.
- **Listening clock.** `startedAt` is UTC and `day` is the local date, so the local hour of a play is unknown. A `utcOffsetMin` on each event would fix this for new plays.
- **Past 400 days.** Events and day buckets expire, and lifetime counts have no dates. Year-over-year comparison, "first song" and exact all-time minutes need a per-track monthly rollup (`months: [{month, plays, listenedMs}]`) kept for the life of the account. That is more personal data held longer, so it is an owner call.
- **Track artists.** Only releases have an `artist`, so features count under the release artist. A track `artists` field starts in `spec/metadata.md`.
- **Genre.** Genre is set once per release and is often null. A client prompt can fill it in, with no contract change.
- **Large ranges.** A year of events runs to many pages, so yearly views want a server-side monthly total.
- **Out of scope.** Playlists, friends and stats.fm's mood and audio features are not in the data; shares never expose plays (#183).

## 7. Three packaging directions for the owner

### A. The listening report

One fixed, quiet page on both apps, like Last.fm's weekly report. From the top: a period switch, one sentence saying what happened, three numbers in type, then ranked lists with #1 large over its cover wash and the rest plain and numbered. Days played, decades and genres appear below only when the data supports them.

- **Default view:** This month: minutes, plays and tracks, then top tracks, with Albums and Artists one switch away.
- **Customising:** period (including a custom range), sort by plays or minutes, and list length. Nothing to arrange.
- **Fit:** direct. Rule 7 is the layout and the cover wash is the colour (rule 1). Skeletons follow the shape of the lists (rule 10), and the period chooser is a slim neutral track (rule 6).
- **Effort:** low to medium: a restyle of the existing Mac and iPhone pages, without medals or shimmer.
- **API:** nothing new. Minutes and days need #368.

### B. The stats shelf

A library of plain cards that the user arranges, like Square's reports. There are about twelve: top tracks, albums and artists; minutes; streak; milestones; on this day; decades; genres; clock; by device; and recently finished. Each card has its own period.

- **Default view:** five starter cards: minutes, top tracks, top albums, streak and on this day.
- **Customising:** an Edit mode adds, removes and reorders cards and sets each card's period. The order is saved per device at first.
- **Fit:** workable with flat cards and type-based ranks. The risk is a dashboard that loses the cover, wash and sleeve, which the rules name as the source of the feeling.
- **Effort:** medium to high: a catalogue, edit modes on two platforms, stored preferences, and loading and empty states for every card.
- **API:** nothing at first. Syncing the shelf needs a settings field, and the clock card needs `utcOffsetMin`.

### C. Replay

Monthly and yearly stories, like Wrapped, with a plain list underneath for browsing. Each month is a short run of pages: minutes, top track, top album, something new, the longest streak, then a share image. December adds the year.

- **Default view:** the latest finished month, with older months in an archive.
- **Customising:** little beyond picking a month and choosing whether to share.
- **Fit:** needs care. Motion must explain and have a still version (rule 9); the turning record and the sleeve can carry it. The pull is towards Wrapped's novelty, which the owner wants gone.
- **Effort:** high. It needs a story layout on two platforms and share images, and is thin until a year of events exists.
- **API:** a server-side monthly total, share images that keep plays off share links (#183), and data past 400 days.

**Pick.** I would pick A, then add per-section show or hide and a monthly recap card from C once #368 has a few months of events. People want correct numbers on a stable page and customise range and sort, not layout (stats.fm's home change drew about 250 votes against it, layout requests single digits), and A retires the medals most directly under rules 7 and 10.

## 8. Open questions for the owner

1. Did you mean stats.fm-style customisation (period, sort, range), or arranging sections?
2. Rank by plays or by minutes by default?
3. Keep the five-sleeve fan, plain, or use #1 large above a numbered list?
4. Store `utcOffsetMin` on events so a listening clock is possible?
5. Record skips, which adds personal data?
6. Keep a monthly rollup past 400 days?
7. Should there be share images, and what may they show (#183)?
8. Track-level artists, through `spec/metadata.md`?
9. Milestone or monthly-recap notifications, or none?
10. Sync stats settings between Mac and iPhone?
