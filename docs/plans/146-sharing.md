# #146: send a song or release to friends and groups

## What the owner wants (15 Oct decisions on #146)

- Send one song or a whole release to a person, a group, or anyone with a link.
- The recipient downloads it, and it arrives tagged and ready for Spotify.
- **Private shares** (named people) and **public links** (anyone with the link) are **both in the first
  version**. A public link's page invites the visitor to **sign up and claim** the song or album into
  their own Locally library.
- **No download caps during the beta.** Links still expire and can be revoked. Caps or a plan tier
  are revisited before a public launch.
- The sender chooses whether recipients may share it on.

## The honest limits (these shape the UI copy)

- Once a file is downloaded, nothing stops someone sending it on. "Can't share on" only controls
  **Locally's own** sharing: no new links and no forwarding in-app. The UI must never promise more.
- Public links to audio are what turns a service into a piracy host. So public links ship **built but
  switched off in production** behind `PUBLIC_SHARES_ENABLED` (default `false`), and the owner turns them
  on only once the launch gate below is done. Private shares need no gate beyond what sync already has.

## Model (apps/api, new tables)

```
shares(id, owner_user_id, release_id, track_ids_json|null, visibility 'private'|'public',
       allow_reshare bool, expires_at|null, revoked_at|null, created_at,
       snapshot_json)                      -- title, artist, year, genre, cover hash, track list at share time
share_recipients(share_id, user_id, claimed_at|null, hidden_at|null)
share_links(share_id, token_hash, created_at)  -- public only; token never stored in clear
share_downloads(share_id, name, at, via 'recipient'|'link')   -- for monitoring egress, no caps
```

- **What a share points at:** the owner's existing stored files, by release ID and file names. There is
  no copy at share time, so sharing costs no storage.
- **Owner deletes the release:** its shares are revoked. The delete confirm says how many people it was
  shared with. Blobs follow the normal prune.
- **`track_ids_json`:** null means the whole release. A list means just those tracks (sharing one song
  from an album).
- **Groups in v1:** a client-side convenience, a saved list of recipient emails on the device. A share
  still expands to individual recipients, so no group table is needed yet.

## API

| Route | Who | What |
| --- | --- | --- |
| `POST /v1/shares` | owner | Create. Body: release, optional track IDs, recipients (emails), visibility, allow_reshare, expiry. Unknown emails are **not** an error. They're returned as `notOnLocally` (see Accounts). |
| `GET /v1/shares?role=sent\|received` | owner or recipient | List, paged like releases. |
| `DELETE /v1/shares/:id` | owner | Revoke. Recipients see it disappear on their next reconcile. |
| `GET /v1/shares/:id/files/:name` | recipient | Signed download URL, short-lived (5 min). |
| `POST /v1/shares/:id/claim` | recipient | Marks it claimed. The client then imports it into the library and Spotify folder. |
| `POST /v1/shares/:id/reshare` | recipient | Allowed only if `allow_reshare`. Creates a child share owned by the recipient that points at the same files. Revoking the parent revokes the children. |
| `GET /s/:token` | anyone | Public link page (HTML) served by apps/api: cover, title, artist, track list, **Download**, and **Claim in Locally**. 404 when public links are disabled, or the link is unknown, revoked or expired. All of these look identical. |
| `GET /s/:token/files/:name` | anyone | Signed URL for a public download, rate-limited per IP. |

## Clients

**Mac (apps/web) and iPhone (apps/ios):**
- A **Share** action on the release page (and on a track row) opens a share sheet with these choices:
  - **People:** emails, plus saved groups.
  - **Link:** on or off. Shown only when the server says public links are enabled.
  - **Let them share it on:** on or off.
  - **Expires:** never, 7 days or 30 days.
- **"From your friends" tray:** received shares, in the same tray language as "From your phone" (#115).
  Each shows the sender's email and the cover. **Send to Spotify** claims it, downloads it, writes it into
  the library and Spotify folder, tagged exactly as the snapshot says, then hides it from the tray.
- **"Shared by you"** in Settings lists the user's shares, with recipients, claimed or not, and **Revoke**.
- Copy, sentence case: "Shared with 3 people", "Anyone with the link can download this", "They can't
  share it on from Locally".

**Public link page:**
- A light, on-brand page: the cover wash, the sleeve, the title, the tracks.
- **Download** gets the files (one zip for a release, built on the fly, streamed and not stored).
- **Claim in Locally:**
  - Signed in: it adds the share to their tray.
  - Not signed in: it shows sign-in, or "Locally is invite-only right now", until sign-ups open.
- `noindex`, no listing, no Open Graph audio preview.

## Accounts and email

- Sign-ups are closed, and Resend still sends only from the sandbox (#58). So in v1 a private share
  reaches only **existing Locally accounts**, looked up by email. No email is sent; it appears in their
  tray.
- An unknown email returns `notOnLocally`, and the sheet says "Not on Locally yet". The share is not held
  for them.
- Email notifications and invites come after #58. This is a follow-up issue, not part of v1.

## Security

- **Link tokens:** 256-bit random. Only `sha256(token)` is stored. Lookups are by hash, so there's no
  timing oracle on the token. Tokens are never logged.
- **Authorization:** every recipient route checks both the recipient row and the share's state
  (revoked or expired). Owner-only routes check `owner_user_id`. These are added to the cross-user matrix
  (#33): another user gets 404 everywhere.
- **No enumeration:** unknown, revoked, expired and disabled links all return the same 404 page.
- **Signed URLs:** 5-minute expiry, bound to one blob path. Public downloads are rate-limited per IP and
  per link (shared limiter).
- **Public page:** server-rendered, with a strict CSP (no inline script) and no third-party assets.
  Metadata is escaped. ID3-derived titles are untrusted.
- **Kill switch:** `PUBLIC_SHARES_ENABLED=false` makes every `/s/*` route 404 and hides the Link option
  in the clients. The owner can turn public links off instantly.
- **Reshare depth:** at most 3 levels, to stop chains.
- **Abuse monitoring:** `share_downloads` counts per share. The daily cron logs the top shares by
  downloads and bytes, warning past a threshold. This is monitoring, not a cap.

## Cost

- Every download is Blob egress, paid by the owner. There are no caps in the beta (the owner's call).
  The daily cron logs total share egress, next to the existing storage alert (#29).
- Before a public launch: decide on caps or a plan tier. StoreKit is wired but gates nothing.

## Launch gate for public links (production)

Turn `PUBLIC_SHARES_ENABLED` on only after:
1. #36 is done: the terms say only share audio you own or have the rights to (ADR 0005 extends to sharing),
   there's a working takedown contact and process, and a privacy policy.
2. A DMCA designated agent is registered, if serving US users publicly.
3. #58: the email domain is verified, so takedown replies and notices work.
4. The kill switch has been tested in production (on, off, links 404).

## Rollout (each is an issue with a session brief)

1. **API:** tables and migration, routes, the public page, the kill switch (off), the cross-user tests,
   the rate limits, and the `spec/sync.md` "Shares" section. Owner reviews this before merging, because it
   ships a production migration.
2. **Mac:** share sheet, "From your friends" tray, "Shared by you".
3. **iPhone:** the same set. It can run in parallel with step 2 once step 1 is merged.
4. **Launch gate checklist:** an owner task, and the switch.

## Tests

- **API:**
  - Every route's auth and ownership.
  - Revoke and expiry hide the share everywhere.
  - A child reshare respects `allow_reshare` and depth.
  - The public page 404s identically for every bad state and when disabled.
  - Tokens are never in logs (log capture).
  - Zip streaming of a release.
  - The migration.
- **Mac and iPhone:**
  - A claim imports into the library tagged exactly as the snapshot.
  - The tray hides a claimed share.
  - The sheet hides Link when disabled.
  - The `notOnLocally` copy.
