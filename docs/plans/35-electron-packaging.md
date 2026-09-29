# Package the Mac app with Electron (#35)

## Summary

The owner chose option 1 from #35: wrap the existing Next.js Mac app in Electron. The decision
is recorded in `docs/adr/0004-package-the-mac-app-with-electron.md`. This document is the plan
for the later implementation. Implementation is a follow-up issue, not this PR. This change
does not create that issue, and it does not build Electron, Tauri, a SwiftUI Mac app,
packaging, signing, or ffmpeg bundling.

Until that follow-up lands, the app runs as it does today: `cd apps/web && npm install && npm run dev`,
plus `brew install ffmpeg`. Developer-only is how it runs in the meantime. It is not the
long-term packaging answer.

## Later implementation work

A follow-up issue owns all of this. None of it is in this PR.

- **Electron shell.** Wrap the existing `apps/web` Next.js server and UI. Least code change;
  largest bundle. Tauri with a Node sidecar, and a native SwiftUI Mac app, stay rejected.
- **Bundled ffmpeg.** Ship ffmpeg inside the app so a user does not run `brew install ffmpeg`.
  Choose the licence at that time, before the binary is bundled: an LGPL build or a GPL
  build. This plan does not pick one. Keep spawning ffmpeg with an argument array.
- **Signing and notarisation.** Sign the packaged app and notarize it so people who are not
  developers can open it.
- **Auto-update.** Ship updates to installed copies. The update mechanism is chosen in the
  follow-up, not here.
- **Application Support paths.** When the app is packaged, its data directory target remains
  `~/Library/Application Support`. Do not change paths in this PR. Today, config is
  `~/.spotify-local-import` (`settings.json`, `sync-state.json`) and the default library is
  `~/Music/Spotify Local Import`. The follow-up decides how a packaged app finds or migrates
  those files.

## Constraints the follow-up must keep

- **ADR 0003.** The server stays loopback-only, with the Origin check on mutating requests.
  Electron must not expose it on the LAN, and must not bind a non-loopback interface.
- **No path change until the packaging work.** `settingsDir()` and `defaultLibraryDir()` stay
  where they are for the developer checkout.
- **No contract change.** `spec/sync.md` and `spec/metadata.md` are unchanged. iOS and
  `apps/api` are unaffected.
- **Writes stay inside the library.** `ReleaseLayout` and the inside-check still gate every
  user-derived path. The shell does not get a new place to write.

## This PR

Docs only: the ADR, this plan, and the STATUS update. No application code. No follow-up
implementation issue.
