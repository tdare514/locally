# Plan: own updater for the unsigned Mac app (#71, ADR 0007)

Scope is `apps/web` (Electron shell) plus one owner-run publish script. `apps/api`, `apps/ios`,
`spec/` and the sync protocol are unchanged. Implement from this plan in a fresh session.

## Owner actions (one time)

1. Create a **public** Vercel Blob store named `locally-releases` in the project tied to the
   owner's GitHub Vercel account; copy its read/write token to `~/.config/locally/releases.env`
   as `BLOB_READ_WRITE_TOKEN` (never the repo, never `apps/api/.env`).
2. Run `npm run desktop:keygen` once. It writes the private key to
   `~/.config/locally/update-ed25519.pem` (mode 600) and prints the public key to commit.

## Contract

`desktop/latest.json` in the Blob store, always fetched over HTTPS from a pinned URL constant:

```json
{ "manifest": "{\"version\":\"0.2.0\",\"notes\":\"...\",\"builds\":{\"arm64\":{\"url\":\"https://.../Locally-0.2.0-arm64.zip\",\"sha256\":\"<hex>\",\"size\":123}}}",
  "signature": "<base64 Ed25519 over the exact bytes of the manifest string>" }
```

The manifest is a JSON string inside the envelope so the signed bytes are unambiguous. Zip URLs
must be `https:` on the pinned Blob host; anything else is refused.

## Shell changes (`apps/web/electron/`)

- `lib/update-manifest.ts` (pure): parse envelope, verify signature with the compiled-in public
  key (`crypto.verify`), validate shape with zod, compare semver against `app.getVersion()`.
- `lib/updater.ts`: check on launch (10 s delay, at most once per 6 h) and from an
  "Check for Updates…" app-menu item. On a newer version show a dialog with the notes and
  Download / Later. Download to `<userData>/updates/` (size capped at 1.5x the manifest size),
  verify SHA-256, unpack with `execFile("/usr/bin/ditto", ["-x", "-k", zip, dir])`, check the
  unpacked `Locally.app` has bundle id `com.tdare514.locally` and a higher version, then swap:
  rename the running bundle to `Locally.app.old`, move the new one into place, `execFile("open",
  ["-n", newApp])`, quit, and remove the `.old` copy on next launch. If the install directory is
  not writable, or any step fails, restore the old bundle and show the error with the manual
  download instructions. Writes stay inside the app's own bundle path and `<userData>/updates`;
  both are inside-checked like `ReleaseLayout` paths.
- Skipped when `LOCALLY_DESKTOP_SMOKE` or `LOCALLY_DESKTOP_URL` is set (dev, smoke tests).

## Publish script (`apps/web/scripts/publish-desktop.mjs`)

`npm run desktop:publish`: requires a fresh `desktop:package`, zips `Locally.app` with `ditto -c -k
--keepParent`, hashes it, uploads the zip to the store, signs and uploads `desktop/latest.json`
(`allowOverwrite`). Refuses to publish a version not greater than the current manifest's.

## Security

- Only the owner's private key can make an installed copy run new code.
- No shell strings: `execFile` with argument arrays only; the swap uses `fs.rename`, not a script.
- No secrets in the repo: only the public key is committed; token and private key live under
  `~/.config/locally/`.
- Retire before public sign-up: signing (#70) replaces this with `electron-updater`.

## Tests (vitest, no network, temp dirs)

Manifest: valid signature accepted; tampered manifest, wrong key, bad shape, non-Blob or non-https
URL rejected; version comparison including equal and downgrade. Download: hash mismatch and size
overrun rejected with the temp file removed. Swap: success, and rollback when the new bundle
fails the bundle-id check, using a fake bundle tree in a temp dir. Publish script: refuses a
non-greater version.

## Docs

STATUS.md (Desktop line and Next), `apps/web/README.md` (releasing and updating), close nothing:
#71 stays open for the `electron-updater` swap after #70.
