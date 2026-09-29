# 6. Bundle an LGPL ffmpeg in the packaged Mac app

## Status

Accepted. Implemented for #69 (`apps/web/scripts/build-ffmpeg.sh`).

## Context

ADR 0004 chose Electron and left the ffmpeg licence open. The packaged Mac app must not depend on
a Homebrew ffmpeg on the user's machine, so it has to carry its own binary. ffmpeg can be built
under the LGPL or, with GPL components enabled, under the GPL. Locally is a closed project: all
rights reserved, no permissive licence. Upstream ffmpeg publishes no prebuilt macOS binaries, and
the common third-party builds (evermeet, Homebrew) are GPL builds.

## Decision

Bundle an LGPL 2.1+ ffmpeg built from pinned sources with libmp3lame (LAME 3.100, itself LGPL).

- `apps/web/scripts/build-ffmpeg.sh` downloads ffmpeg 9.0.2 and LAME 3.100, verifies each archive
  against a SHA-256 pinned in the script, and builds a static, minimal ffmpeg with
  `--disable-gpl --disable-nonfree --disable-version3`. Only the demuxers, decoders and filters
  the importer needs are enabled, and the only encoder is libmp3lame. The script then checks
  that the binary reports an LGPL licence, links only system libraries, and has libmp3lame.
- The binary is not committed. It is built into `electron/vendor/ffmpeg/<arch>/` (git-ignored),
  and `desktop:package` refuses to run without it.
- The LGPL and licence texts and `SOURCES.md` (components, versions, URLs, checksums, configure
  line) are committed in `electron/build/licenses/` and ship in `Contents/Resources/licenses`.

Rejected: a GPL build, because distributing it would put the whole distributed app under the
GPL. Rejected: downloading a prebuilt binary, because no trustworthy prebuilt LGPL macOS build
exists upstream.

## Consequences

- LGPL obligations: ship the LGPL text, state which sources the binary was built from, and offer
  them (`SOURCES.md` gives the URLs). Relinking is satisfied because ffmpeg ships as a separate
  executable run as its own process, not as libav* linked into the app.
- The build is host-arch only. An Intel build needs a run of the script on an Intel Mac, or a
  cross-compile follow-up.
- Upgrading ffmpeg or LAME means changing the pinned versions and checksums in the script and
  updating `SOURCES.md` and this record.
- The packaged app no longer needs Homebrew ffmpeg. `npm run dev` still uses ffmpeg from PATH.
- Signing and notarisation (#70) must sign this binary too.
