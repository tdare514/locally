# Locally (web and desktop)

## Releasing and updating the desktop app

Interim until signing and notarisation (#70) land; then `electron-updater` replaces this (ADR 0007,
`docs/plans/71-own-updater.md`).

One-time owner setup:

1. Create a public Vercel Blob store named `locally-releases` in the Vercel project tied to your GitHub account.
2. Put its read/write token in `~/.config/locally/releases.env` as `BLOB_READ_WRITE_TOKEN=...`.
3. Run `npm run desktop:keygen`. It writes `~/.config/locally/update-ed25519.pem` (mode 600) and prints the public key.
4. Paste the public key into `UPDATE_PUBLIC_KEY_PEM` and the manifest URL
   (`https://<store>.public.blob.vercel-storage.com/desktop/latest.json`) into `UPDATE_MANIFEST_URL` in
   `electron/lib/updateConfig.ts`, and commit. Empty values disable the updater.

Each release:

1. Bump `version` in `package.json`.
2. `npm run desktop:package`
3. `npm run desktop:publish -- --notes "What changed"`. It refuses a version not greater than the published one.

Users are prompted on launch (at most every 6 hours), or via Locally, Check for Updates. The download is
checked against the signed manifest's SHA-256 before the app bundle is swapped in. The app must sit in a
folder the user can write to (e.g. `~/Applications`); otherwise the prompt explains the manual download.

A copy built before the updater (0.1.0) has no updater: replace it by hand once with the first updater build.
