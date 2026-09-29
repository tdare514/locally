# 4. Package the Mac app with Electron

## Status

Accepted. The packaging path is decided. It is not implemented in this change, and it is not
in progress as code. Until a later implementation, the app stays a developer checkout.

## Context

Today the Mac app is `cd apps/web && npm install && npm run dev`, plus `brew install ffmpeg`.
Nobody but a developer can install it. Issue #35 asked how other people should install it: a
packaged, signed Mac app, ffmpeg bundled with it, auto-updates, and a data directory under
`~/Library/Application Support`.

The options were:

1. Wrap the existing Next.js server in Electron (least code change; largest bundle).
2. Tauri with a Node sidecar (smaller; more build complexity).
3. A native SwiftUI Mac app sharing code with `apps/ios` (most work; best fit on macOS; drops
   the web UI).
4. Stay developer-only for now and accept that Mac users are just the owner.

Bundling ffmpeg raises a licence question (an LGPL build or a GPL build). A packaged app also
has to be notarised, and it has to keep the loopback server and Origin check from ADR 0003.
Config today lives in `~/.spotify-local-import` (`settings.json`, `sync-state.json`); the
default library is `~/Music/Spotify Local Import`.

## Decision

Option 1. Wrap the existing Next.js Mac app in Electron. That is the planned packaging path.
Electron is the chosen wrapper because it is the least code change; the bundle will be the
largest of the options.

Rejected for now: Tauri with a Node sidecar, a native SwiftUI Mac app, and staying
developer-only forever. Developer-only remains how the app runs until the Electron plan is
implemented later.

The ffmpeg licence is decided at implementation time, before bundling: an LGPL build or a GPL
build. This record does not pick one.

Notarisation and auto-updates belong to that later implementation, not to this decision.

The data-directory target, once the app is packaged, remains `~/Library/Application Support`.
Paths stay as they are until that implementation. This change does not move them.

ADR 0003 still applies. The server stays loopback-only, and mutating requests keep the Origin
check. The Electron shell must not expose the server on the LAN.

## Consequences

- Install stays `cd apps/web && npm install && npm run dev` and `brew install ffmpeg` until
  the follow-up that builds the shell.
- That follow-up is outlined in `docs/plans/35-electron-packaging.md`: the Electron shell,
  bundled ffmpeg (licence chosen then), signing and notarisation, auto-update, and the
  Application Support data directory. It is a separate issue. This change does not open it
  and does not start the code.
- The Electron shell is constrained by ADR 0003: bind loopback only, keep the Origin check,
  and do not publish the server on the LAN.
- Choosing Electron keeps the Next.js app and accepts a larger bundle.
- Revisiting Tauri, a SwiftUI Mac app, or developer-only as the long-term answer takes a new
  ADR.
