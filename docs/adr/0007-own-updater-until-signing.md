# 7. Ship our own signed-manifest updater until the app is Developer ID signed

## Status

Accepted (owner chose this path on 29 Sep 2026). Plan: `docs/plans/71-own-updater.md`.

## Context

#71 asked for auto-update and named `electron-updater` with GitHub Releases. That path is blocked by
#70: `electron-updater` on macOS uses Squirrel.Mac, which refuses an unsigned app. The owner does
not plan public demos or sign-ups before 1 Nov 2026, and wants the installed Mac app to update
itself now, with signing later. The only installed copies before then are the owner's own.

## Decision

Build a small updater in the Electron shell that does not need a code signature, and replace it
with `electron-updater` when #70 lands.

- **Hosting:** a new public Vercel Blob store, `locally-releases`, separate from the private sync
  store. It holds one zip per release and a fixed `desktop/latest.json`. Publishing needs no API
  deploy and puts no repo token in the app.
- **Integrity:** the manifest is signed with an Ed25519 key. The private key stays on the owner's
  Mac, outside the repo; the public key is compiled into the shell. The app trusts a release only
  if the manifest signature verifies and the downloaded zip matches the manifest's SHA-256. A
  compromised Blob store or Vercel account therefore cannot push code to installed copies.
- **Install:** the app prompts, downloads, verifies, unpacks with `ditto` (argument array), and
  swaps the `.app` bundle in place. A file written by our own process carries no quarantine flag,
  so Gatekeeper does not block the new bundle. This only holds while the owner is the only user.
- **Never silent:** no download or install without a prompt, as #71 required.

## Consequences

- Releases are published with a local script by the owner; a lost private key means reinstalling
  by hand once with a new public key.
- Before any public sign-up the app must be signed and notarised (#70) and this updater retired in
  favour of `electron-updater` (#71 stays open for that). Notarised builds must not use this path.
- Rejected: `electron-updater` with ad-hoc signing (Squirrel.Mac rejects it), and GitHub Releases
  on the private repo (every installed copy would carry a token that can read the repo).
