# Security model

This app runs a local Node server that writes to the user's disk (tagged music files,
a settings file, a library index) and shells out to `ffmpeg`/`open`. It's designed to
be used from a single browser on the same machine, but it still has to defend against
a browser that can reach it — other tabs, other sites, and other hosts on the LAN.

## Threat model and mitigations

### Cross-site request forgery (CSRF) from other browser tabs

A malicious page open in another tab could try to `fetch("http://localhost:3000/api/...")`
to make the server import files, delete releases, or repoint the library dir.

**Mitigation**: `src/proxy.ts` rejects any mutating request (`POST`/`PUT`/`PATCH`/`DELETE`
under `/api/`) whose `Origin`/`Referer` is not itself a loopback host. Browsers always
attach `Origin` on cross-site mutating requests, so a same-origin fetch from this app's
own page passes and everything else is rejected with 403.

### DNS rebinding / LAN exposure

An attacker-controlled DNS name could resolve to `127.0.0.1` after the browser's initial
same-origin check, or the dev server could be exposed to other devices on the LAN.

**Mitigation**: `src/proxy.ts` checks the `Host` header on every request and rejects
anything that isn't `localhost`/`127.0.0.1`/`[::1]`, regardless of what DNS resolved.

### Path traversal via user-controlled names

Artist/album/track names, cover filenames, and the `reveal` path all come from the
client and end up in filesystem paths. Without sanitisation, `../../etc` in an artist
name could escape the library directory.

**Mitigation**: every user-derived segment is sanitised by
`src/server/releases/ReleaseLayout.ts` (`sanitizeSegment`, `folderFor`, `trackFileName`,
`coverFileName`) before it becomes part of a path, and every write/delete/reveal target
is additionally checked with `FileSystem.isInside` (`src/server/fs/NodeFileSystem.ts`)
against the current library directory before use — see `ReleaseService.delete` and
`src/app/api/reveal/route.ts`.

### Malicious uploads

An uploaded "cover.jpg" could actually be an arbitrary file (script, executable, huge
blob) that gets written to disk and later served back with an attacker-chosen
content-type.

**Mitigation**: `src/server/http/validation.ts` enforces an extension allowlist, size
caps (`MAX_COVER_BYTES` = 10MB, `MAX_AUDIO_BYTES` = 500MB), and sniffs the actual leading
bytes of image uploads (`sniffImageMime`) rather than trusting the filename or the
browser-supplied MIME type. The cover GET route serves a content-type derived from the
file's own extension, not from user input.

### Command injection via ffmpeg/open

Filenames and paths derived from user input are passed to external processes.

**Mitigation**: both `src/server/audio/FfmpegConverter.ts` and `src/app/api/reveal/route.ts`
invoke `spawn`/`execFile` with argument arrays, never a shell string built by
concatenating user input — so there is no shell to inject into.

## Reporting

This is a local single-user tool with no network service beyond localhost. If you find
an issue, open an issue in this repository describing the reproduction steps.
