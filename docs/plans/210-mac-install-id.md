# #210: know a returning Mac by an install ID, not only its name

## Why

#191 (#175) lets a Mac that signs out and back in reuse its revoked device row, so its plays aren't counted twice. It matches on the device **name**, which is `os.hostname()`. macOS changes that name on a Bonjour clash (`MacBook-Pro-2.local`), and networks can hand out their own. When it changes, the Mac becomes a new device and its plays double. Two Macs with the same name can also share one row.

## Design

- **The Mac's install ID.** A random UUID is made once and kept in the config dir settings (`FileSettingsStore`, mode 0600) as `installId`.
  - It survives sign-out, sign-in, a sync host change and app updates.
  - It isn't made per account.
  - It isn't secret, but it's never logged or shown.
- **Sign-in.** `POST /v1/auth/verify` takes an optional `installId`: a UUID, accepted only when `platform` is `mac`, and ignored for other platforms. The server stores it on the device row.
- **Which revoked device the server revives**, for a Mac signing in to the same user, in order:
  1. a revoked Mac row of this user with the **same** `install_id`;
  2. otherwise, a revoked Mac row of this user with **no** `install_id` and the same name (the #191 rule, for rows made before this change);
  3. otherwise, a new device.

  A row with a **different** non-null `install_id` is never revived by name. That stops two same-named Macs from sharing a row.

  A revived row gets the new token, and keeps or gains the `install_id`. An active row is never taken over.
- **Old clients.** A Mac that sends no `installId` keeps today's name rule exactly. iPhones are unchanged.

## Contract (`spec/sync.md`, same PR)

- `POST /v1/auth/verify` body: optional `installId` (UUID, Mac only). The effect on each client is stated:
  - **Mac:** sends it from this release on.
  - **iPhone:** doesn't send it.
  - **Old Mac builds:** keep the name rule.

## Migration

- `devices.install_id` (nullable text) and an index on `(user_id, install_id)`. No backfill: existing rows match by name until their Mac next signs in with an ID.
- Production migration, so the **owner reviews before merge**.

## Security

- The ID is a hint inside one account. Revival is scoped to the signed-in user's own revoked Mac rows, after the email code has been proven, so another account's ID never matches anything.
- A Mac whose config dir is copied to another Mac (Migration Assistant) shares the ID. That second Mac could revive the first one's row only after the first one is signed out, which is the same as the first Mac continuing, and fine.
- The cross-user matrix gains:
  - user B signing in with user A's install ID gets a new device;
  - user A's row is untouched.

## Tests

- **API:**
  - a renamed Mac with the same install ID gets its old row back (new token, old token dead);
  - same name but a different install ID gets a new row;
  - a pre-change row (no ID, same name) is revived and gains the ID;
  - an active row is never taken;
  - a non-Mac platform's `installId` is ignored;
  - the cross-user case;
  - a malformed ID is a 400.
- **Mac:**
  - the ID is made once and kept across sign-out and a host change;
  - verify sends it;
  - the settings file keeps mode 0600.

## Session brief (for the build)

```
Model: sonnet (a spec'd change across the API and the Mac client)
Read only: docs/plans/210-mac-install-id.md, apps/api/AGENTS.md, apps/api/src/server/auth/AuthService.ts, apps/api/src/db/schema.ts, apps/web/AGENTS.md, apps/web/src/app/api/sync/verify/route.ts, apps/web/src/server/sync/SyncApi.ts, apps/web/src/server/config/FileSettingsStore.ts, spec/sync.md
Do not touch: apps/ios
Verify: cd apps/api && npm run check; cd apps/web && npm run check
Done when: the tests above pass, spec/sync.md documents the field, and the PR is marked for owner review (production migration)
```
