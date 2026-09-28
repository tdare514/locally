# Account deletion across API, iOS and web (#34)

## Summary

A user can create a sync account with an email code but cannot delete it. This plan adds
`DELETE /v1/me` to the sync API and a "Delete sync account" control to both clients. The call is
made with the current device token and an explicit confirmation (the account email echoed in the
body, behind a confirm dialog in the UI). The server removes the user, its devices, releases,
file rows and open auth codes in one transaction and queues every blob for deletion; the queue
is drained in the background right after the response and, as the guarantee, by the daily
cleanup cron. Music files on the Mac and the iPhone are never touched; only the cloud copy goes.
The deleting device signs itself out; every other device's token stops working at once (401).
App Store Review Guideline 5.1.1(v) requires exactly this before the iOS app can ship with sync.

## Current behaviour

- Accounts: `AuthService.getOrCreateUser` (`apps/api/src/server/auth/AuthService.ts`, ~line 61)
  creates a `users` row on first verified code. Nothing deletes one.
- Per-user tables (`apps/api/src/db/schema.ts`): `users`, `devices` (`user_id`), `user_counters`
  (`user_id`), `releases` (`user_id`, tombstones kept as `deleted = true`), `files` (`user_id`,
  `release_id`, `storage_key`). `auth_codes` and `rate_limits` are keyed by email or IP, not
  user id. There are no foreign keys or cascades.
- Every blob has a `files` row: `ReleaseFilesService` inserts the row when it hands out the
  upload ticket (~line 94), with a server-built key `users/<userId>/releases/<releaseId>/<name>`
  (`storageKeyFor`, ~line 22). The `files` table is therefore the complete list of a user's
  blobs.
- Blob deletion today: `PUT /v1/releases/:id` prunes unreferenced files inside the request, and
  `CleanupService.run` (`apps/api/src/server/cleanup/CleanupService.ts`) deletes the files of
  tombstones older than 30 days, one `fileStore.delete` at a time. Issue #31 moves both off the
  request path and batches them.
- `DELETE /v1/devices/:id` (`apps/api/src/app/v1/devices/[id]/route.ts`) is the only
  destructive account route; it is the template for the new one (`requireAuth`, then a service
  call scoped by `user.id`).
- Web sign-out (`apps/web/src/app/api/sync/signout/route.ts`): best-effort `revokeDevice`, then
  clears `deviceToken`, `email` and `lastVersion` in settings. It leaves `SyncState`
  (`pushedUpdatedAt`, `uploadedFiles`, `coverHash`, `pendingFromPhone` in
  `apps/web/src/server/sync/SyncState.ts`) untouched, so a later sign-in to a different account
  believes every release is already pushed and never uploads it. The UI is the "Sign out"
  button in `apps/web/src/components/SettingsView.tsx` (`handleSignOut`, ~line 154).
- iOS sign-out (`SyncEngine.signOut`, `apps/ios/Locally/Services/SyncEngine.swift`, ~line 189):
  best-effort `revokeDevice`, then `account.clear()`, `outbox.removeAll()` and a status reset.
  It leaves each release's `syncedUpdatedAt` (`LibraryStore`, ~line 47) in place, the same
  re-push gap as web. The button lives in
  `apps/ios/Locally/Views/Settings/SyncSettingsSection.swift` (~line 131); copy comes from
  `Copy.Sync` in `apps/ios/Locally/Resources/Copy.swift`.
- A 401 from the API surfaces on web as `SyncAuthError` (`apps/web/src/server/sync/SyncApi.ts`,
  ~line 61) and on iOS as `SyncApiError.unauthorized` (`SyncApi.swift`, ~line 56). Neither
  engine signs the device out on its own today; #33 is where "401 means signed out" is
  verified on both clients.

## Contract change (spec/sync.md)

### `DELETE /v1/me`

Headers: `Authorization: Bearer <device token>` like every other account route.

Body: `{ email }`. It must equal the account's email after the same normalisation the auth
routes apply (trim, lower-case). This is the explicit confirmation the issue asks for: a client
cannot delete an account by accident with a bare call, and a request always names the account
it is about. The clients send the stored account email; the human confirmation is a dialog in
the UI, not a typed field.

Response: `{ ok: true }`.

Effect, all in one transaction (`db.batch`):

- deletes the `users` row, every `devices` row (revoked ones included), the `user_counters`
  row, every `releases` row (tombstones included) and every `files` row for the user;
- deletes every `auth_codes` row for that email, consumed or not;
- inserts one `pending_deletes` row per `files.storage_key` that was removed (see below).

After the transaction the blobs are deleted in the background and, as the guarantee, by the
cleanup cron (below). Every device token of the account is invalid from the moment the
transaction commits: any later request with one returns 401. Signing in again with the same
email creates a new, empty account with a new user id, quota usage 0 and version counter 0.

Errors: 401 without a valid token (as everywhere); 400 `ValidationError` when the body is
missing or `email` does not match the account ("email does not match this account"); nothing
is deleted in either case. The route is idempotent in the only way that matters: a second call
with the same token is a 401.

### `GET /v1/internal/cleanup`

Add to its description: "drains `pending_deletes` (blobs of deleted accounts), oldest first".
The existing tombstone, auth-code and rate-limit steps are unchanged.

### Table row and prose

Add the row to the API table:

| Method and path | Body / query | Returns |
| --- | --- | --- |
| DELETE `/v1/me` | `{ email }` (must match the account) | `{ ok: true }`; deletes the account, its devices, releases and files; blobs are removed by the cleanup cron within a day; every device token becomes invalid |

Add a short "Account deletion" paragraph under "What each client does": the deleting client
calls `DELETE /v1/me`, then clears its own token, cursor and per-release sync markers exactly as
sign-out does; local music files are never touched. Other devices learn about the deletion by
receiving a 401 on their next reconcile.

### Why the device token plus a confirm, not a fresh email code

The issue allows either. This plan uses the device token because a token already grants every
destructive power over the account's data: `DELETE /v1/releases/:id` tombstones any release and
`PUT` prunes its files immediately. Deleting the account adds no new reach for a stolen token,
and the account row itself is recreated by the next sign-in, while the user's music stays on
their devices. A fresh email code would add a second code flow to both clients and would make
deletion depend on outbound mail, which is still waiting on the Resend key (#3). Token expiry
(#33) closes the "token from a lost device works forever" gap independently. If a re-confirm by
code is wanted later it is additive: `DELETE /v1/me` gains an optional `code` field and the
server requires it; that is listed under "Not in this plan".

### Why blobs are queued instead of deleted inline

A library of a few hundred releases holds thousands of blobs, and `FileStore.delete` is one
network round trip each. Deleting them before responding would run past the function's time
budget on a large account and leave a half-deleted account behind on timeout. Queueing inside
the same transaction as the row deletes makes the account's disappearance atomic, and the cron
makes blob deletion guaranteed even if the function dies right after the commit. Keys in the
queue are the server-built `storage_key` values copied from `files`, never client input.

## Compatibility and migration

- Schema: a new table `pending_deletes` (`storage_key` text primary key, `enqueued_at` integer,
  `attempts` integer default 0) via `npm run db:generate`, migration committed under `drizzle/`.
  Additive; migrations run on first request as today.
- `syncVersion` and the record shape are untouched. No change to any existing route or
  response.
- Old clients against the new server: unaffected until their account is deleted from another
  device, at which point they get 401 (shown as `lastError` until #33's sign-out-on-401 lands,
  then as the sign-in prompt). Web already shows "Invalid or revoked device token" in that case.
- New clients against an old server (a dev API not yet updated): `DELETE /v1/me` is a 404 or
  405; the client surfaces the error and keeps the account, so nothing is half-done.
- Deploy order: API first, then either client.

## Security implications

- Scoping: the route takes `userId` from `requireAuth`; the body's `email` is compared with the
  stored email and is never used to look anything up. A mismatch is a 400 and deletes nothing.
- The token is the credential. See "Why the device token plus a confirm" above for why that is
  no weaker than today; #33 (expiry) and this plan are independent.
- Atomicity: one `db.batch` for every row delete and the queue inserts, so there is no window
  where the user is gone but a device token still resolves, or where releases survive an
  account. The delete statements repeat `user_id = ?` in their `WHERE`; nothing is deleted by a
  list of ids fetched earlier.
- Blob deletion is guaranteed, not best-effort: the queue survives a function crash, the cron
  retries, and `FileStore.delete` is safe on a missing key (its contract). A key stays queued
  until its delete succeeds; `attempts` is only for logging.
- Nothing is leaked: the response is `{ ok: true }`, and a token for a deleted account gets the
  same 401 as any bad token. Logs carry the user id and row counts, never the email (#29
  format).
- Rate limiting: none added. The route is authenticated and is one call per account lifetime;
  the auth routes that a re-sign-in goes through keep their existing limits.
- Privacy remainder: `rate_limits` rows keyed by email (`code:email:*`, `verify:email:*`) are
  not touched; the cron already deletes them within 24 hours. State this in the copy as "within
  a day" rather than "immediately".
- Clients: the web route lives behind the loopback server and the full-origin CSRF check like
  every other `/api/sync/*` route; it writes only the settings file and the sync-state file,
  never the library directory. iOS writes only the Keychain, `UserDefaults`, the outbox and the
  `syncedUpdatedAt` column; never the Spotify folder or the app's cover store.

## Affected components

### spec/sync.md

The changes under "Contract change".

### apps/api

- `src/db/schema.ts`: `pendingDeletes` table; generated migration under `drizzle/`.
- New `src/server/account/AccountService.ts` with `deleteAccount(userId, email)`:
  load the user (404 `NotFoundError` if missing, which cannot happen behind `requireAuth` but
  keeps the service honest), compare normalised emails (400 `ValidationError` on mismatch),
  select the user's `files.storage_key` list, then one `db.batch` with the deletes listed in the
  contract plus `insert into pending_deletes ... on conflict do nothing`. Returns the counts and
  the list of queued keys. Wire it in `container.ts`.
- New `src/app/v1/me/route.ts` `DELETE` handler next to the existing `GET`: `requireAuth`,
  `parseJsonBody` with a new `deleteMeRequestSchema` (`{ email: emailSchema }` in
  `src/shared/types.ts`), call the service, then `after()` from `next/server` (Next 16 is in
  use; swap for #31's `waitUntil` helper if that has landed) to drain the queued keys for this
  user once in the background, and respond `{ ok: true }`. Failures in the background drain are
  logged and left to the cron.
- `CleanupService.run`: a new first step that reads `pending_deletes` oldest first in pages of
  200, calls `fileStore.delete` per key (or `deleteMany` once #31 adds it), deletes the row on
  success, increments `attempts` on failure and moves on. `CleanupResult` gains
  `drainedPendingDeletes`. Extract the "delete this key and its row" helper so the account
  route's background drain and the cron share it.
- `AGENTS.md` (api): add `account/  AccountService: delete a user and queue its blobs` to the
  map and one bullet to the rules: "Account deletion is one transaction plus the
  `pending_deletes` queue; never delete blobs inline in a request."
- `SECURITY.md`: a line on the deletion route and its confirmation rule.

### apps/web

- `SyncApi`: `deleteAccount(email: string): Promise<void>` on the interface and the fetch
  implementation (`DELETE /v1/me`, JSON body). 401 keeps throwing `SyncAuthError`.
- New `src/app/api/sync/account/route.ts` with `DELETE`: read settings; if no token, 400
  "Not signed in". Call `syncApiFactory(baseUrl, token).deleteAccount(settings.sync.email)`.
  On success, or on `SyncAuthError` (the account is already gone or this device was revoked;
  say so in the response as `{ ok: true, alreadySignedOut: true }`), clear `deviceToken`,
  `email` and `lastVersion` and reset the sync state with `emptySyncState()`. On any other
  error, change nothing and return the error. The library directory is never read or written.
- `signout/route.ts`: also reset the sync state to `emptySyncState()`, closing the re-push gap
  noted in "Current behaviour" (one line; same file family, same reason).
- `src/lib/api-client.ts`: `deleteSyncAccount()`.
- `SettingsView.tsx`, sync section, signed-in state: a "Delete sync account…" destructive text
  button under "Sign out". It opens the app's existing confirm dialog pattern with the title
  "Delete your sync account?" and the body "This removes your account and every release and
  file Locally has stored in the cloud for it. Your music on this Mac and on your iPhone stays
  where it is. Other devices signed in to this account are signed out." Buttons: "Cancel" and
  "Delete account" (destructive). On success, toast "Sync account deleted", clear the email
  field and refresh status, exactly like sign-out.

### apps/ios

- `SyncApi` protocol and `HttpSyncApi`: `deleteAccount(email:)` sending `DELETE /v1/me` with a
  JSON body; 401 keeps mapping to `.unauthorized`.
- `SyncEngine.deleteAccount() async -> Bool`: call `api.deleteAccount(email: account.email)`;
  on success or `.unauthorized`, run the local part of `signOut` (no `revokeDevice`), then
  `library.clearSyncMarkers()`; on any other error set `status.lastError` and keep the account.
  Split `signOut` so both paths share the local clearing, and make `signOut` also call
  `clearSyncMarkers()` (the same gap as web).
- `LibraryStore`: `clearSyncMarkers()` sets `syncedUpdatedAt = nil` on every release in one
  save. Nothing else in the store changes; no file on disk is touched.
- `SyncSettingsSection.swift`: a destructive "Delete sync account…" button below "Sign out",
  showing a `.alert` with `Copy.Sync.deleteAccountTitle`, `deleteAccountMessage` (same wording
  as web, with "on your iPhone and on your Mac"), a destructive `deleteAccountConfirm` and
  cancel. Busy state while the call runs; on failure the section shows `lastError` as it does
  for sync errors.
- `Copy.swift`: the four `Copy.Sync` strings above.
- `FakeSyncApi` in `LocallyTests/Fakes.swift`: record `deleteAccount` calls, with switches to
  throw `.unauthorized` or a network error.
- App Store: the control is in Settings, two taps from the tab bar, which satisfies 5.1.1(v)'s
  "easy to find" wording; note the path in the submission checklist.

## Tests

### apps/api (vitest, `npm run check`)

- `AccountService.test.ts`, seeded through `tests/support/fixtures` with two users A and B, each
  with two devices (one revoked), three releases (one tombstoned), and files whose blobs exist
  in the temp `LocalFileStore`; an open `auth_codes` row for A's email:
  - `deleteAccount(A, A.email)`: no row for A remains in `users`, `devices`, `user_counters`,
    `releases`, `files` or `auth_codes`; `pending_deletes` holds exactly A's storage keys;
    every B row and every B blob is untouched.
  - Email mismatch (B's email, a different case with extra spaces is a match, a different
    address is not): 400, and a full row count shows nothing changed.
  - A's tokens: `auth.authenticate` throws `UnauthorizedError` afterwards.
  - Re-verify with A's email: a new user id, `listSince(…, 0)` empty, `usedBytes` 0.
- `CleanupService.test.ts`: after a delete, `run()` removes A's blobs from the store and empties
  the queue while B's blobs remain; a store that fails for one key leaves only that row queued
  with `attempts` 1, and the next run finishes it.
- `routes.test.ts`: `DELETE /v1/me` without a token is 401; with a body missing `email` is 400;
  with A's token and email is 200 and the same token then gets 401 on `GET /v1/me`; B's token
  still works and B's release list is unchanged (extends the cross-user matrix #33 asks for).

### apps/web (vitest, `npm run check`)

- `routes/sync-routes.test.ts`, `DELETE /api/sync/account`: calls the fake API's
  `deleteAccount` with the stored email; clears token, email and cursor; resets sync state to
  empty; returns the public settings shape without a token. When the fake throws a network
  error: no local change and an error response. When it throws `SyncAuthError`: local state is
  cleared and the response flags `alreadySignedOut`. In every case the temp library directory's
  file listing is identical before and after.
- The sign-out test gains the assertion that sync state is reset.
- `SyncEngine.test.ts`: push a release, delete the account through the route, sign in again
  (fake API, new account), reconcile: the release is pushed again, so the reset of
  `pushedUpdatedAt` is exercised end to end.

### apps/ios (XCTest via `xcodebuild`, see `apps/ios/AGENTS.md`)

- `SyncEngineTests.swift`: `deleteAccount()` calls the fake with the stored email, clears the
  account store, empties the outbox, resets status and sets every release's `syncedUpdatedAt`
  to nil; a network failure keeps the account, outbox and markers and sets `lastError`; an
  `.unauthorized` clears locally like success. The fake library's file set is unchanged.
- `SyncAccountStoreTests.swift`: no new cases; `clear()` is already covered.
- `SyncEngineTests`: `signOut()` now also clears the markers (one added assertion).

## Order and dependencies

- The spec, the API service, route, migration and cron step can land any time; #28 (atomic
  version bump) is already in, and nothing here touches the version counter beyond deleting the
  row.
- #31 and this plan both add background work and batching. Land whichever is ready first; the
  second one adopts the other's helper (`waitUntil` wrapper, `deleteMany`). The
  `pending_deletes` queue introduced here is also the natural home for #31's release prune if
  that issue wants it.
- The clients land after #19 and #27 (the iOS `SyncEngine` is being restructured in that lane)
  and after #3 is fully deployed, as the issue says. The web change touches only the sign-out
  route, `SyncApi`, `SettingsView` and a new route, so it does not collide with #37 or #30.
- #33's "401 signs the device out" is what makes the *other* devices tidy up on their own after
  a deletion; without it they show an error until the user signs out manually. It is not a
  blocker for this plan.

## Not in this plan

- Re-confirmation by a fresh email code (additive `code` field later, see the contract
  rationale).
- A grace period or soft delete. Apple accepts an immediate delete; a delayed one would need
  its own disclosure and a way to cancel.
- Deleting local music or covers on either device. Never.
- An "export my data" step before deletion, and account deletion from a web page for users who
  no longer have the app.
- A device-management screen (revoke one device from another) and pagination of the device
  list (#30).
- Batching blob deletes and moving the release prune off the request path (#31).
