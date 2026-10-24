import { constants } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NotFoundError } from "../../shared/errors";
import type { Release } from "../../shared/types";
import type { ReleaseLayout } from "./ReleaseLayout";

/** Audio the Mac's player will serve, by extension (#338). Anything else is not playable here. */
const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
};

export interface TrackAudioFile {
  /** The open file, checked to be the one that passed the containment check. The caller streams it and closes it. */
  handle: fsp.FileHandle;
  size: number;
  contentType: string;
}

/** For tests: run between the containment check and the open, where a swap would be a race. */
export interface TrackAudioHooks {
  /** Before the first stat (after the first containment check). */
  beforeStat?: () => Promise<void>;
  /** After the first stat, before the open. */
  beforeOpen?: () => Promise<void>;
  /** After the open and its fstat, before the last resolve and stat. */
  afterOpen?: () => Promise<void>;
}

export type ByteRange = { start: number; end: number };

const NOT_FOUND = "This track's file is not available";

async function realOrNull(target: string): Promise<string | null> {
  try {
    return await fsp.realpath(target);
  } catch {
    return null;
  }
}

/** True when `target` is strictly beneath `base`; both are real paths. */
function strictlyBeneath(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * The file behind one track of a release, for the audio route (#338). The path comes from the stored release
 * record, never from the request. It is resolved with realpath (so a symlink that points out is caught) and
 * must sit strictly inside the library folder; an adopted release's file must sit inside the adopt root its own
 * folder is in. Every refusal is the same NotFoundError, so the route does not say which check failed.
 */
export async function resolveTrackAudio(
  layout: Pick<ReleaseLayout, "assertPlainFileName">,
  libraryDir: string,
  adoptRoots: readonly string[],
  release: Release | null,
  trackId: string,
  hooks: TrackAudioHooks = {},
): Promise<TrackAudioFile> {
  // The allowed roots are resolved once, first thing, and every containment check below uses these snapshots. A root is
  // never resolved again in the same request, so renaming it to a symlink later cannot move the goalposts.
  const snapshot = {
    library: await realOrNull(libraryDir),
    adoptRoots: (await Promise.all(adoptRoots.map(realOrNull))).filter((r): r is string => r !== null),
    adoptedFolder: release?.adopted ? await realOrNull(release.folderPath) : null,
  };
  if (!release) throw new NotFoundError("Release not found");
  const track = release.tracks.find((t) => t.id === trackId);
  if (!track) throw new NotFoundError("Track not found");
  if (track.missing) throw new NotFoundError(NOT_FOUND);
  const contentType = CONTENT_TYPES[path.extname(track.filePath).toLowerCase()];
  if (!contentType) throw new NotFoundError(NOT_FOUND);
  try {
    layout.assertPlainFileName(path.basename(track.filePath));
  } catch {
    throw new NotFoundError(NOT_FOUND);
  }

  const realFile = await realOrNull(track.filePath);
  if (!realFile) throw new NotFoundError(NOT_FOUND);

  // The real folders the file may sit in: the library, or the adopt root that holds the release's own folder.
  const bases: string[] = release.adopted
    ? snapshot.adoptedFolder
      ? snapshot.adoptRoots.filter((root) => snapshot.adoptedFolder === root || strictlyBeneath(root, snapshot.adoptedFolder!))
      : []
    : snapshot.library
      ? [snapshot.library]
      : [];
  const inside = (real: string) => bases.some((base) => strictlyBeneath(base, real));
  if (!inside(realFile)) throw new NotFoundError(NOT_FOUND);

  await hooks.beforeStat?.();
  const checked = await fsp.stat(realFile).catch(() => null);
  if (!checked || !checked.isFile()) throw new NotFoundError(NOT_FOUND);

  await hooks.beforeOpen?.();

  // Open once, without following a symlink at the end, then check the open file is the one that was checked, and that the
  // path still resolves inside the same roots to the same file (dev and ino). Node has no openat, so these repeated
  // pathname checks narrow the races between check and open but do not remove them. What is left needs write access to
  // the library by the same user, and this server only answers on loopback. Nothing opens by path again.
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(realFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new NotFoundError(NOT_FOUND);
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== checked.dev || opened.ino !== checked.ino) throw new NotFoundError(NOT_FOUND);
    await hooks.afterOpen?.();
    const again = await realOrNull(track.filePath);
    if (!again || !inside(again)) throw new NotFoundError(NOT_FOUND);
    const last = await fsp.stat(again).catch(() => null);
    if (!last || last.dev !== opened.dev || last.ino !== opened.ino) throw new NotFoundError(NOT_FOUND);
    return { handle, size: opened.size, contentType };
  } catch (err) {
    await handle.close().catch(() => undefined);
    throw err;
  }
}

/**
 * Parses a `Range` header against a file of `size` bytes. `null`: no header (answer 200 with the whole file).
 * `"invalid"`: malformed, not in bytes, several ranges, or past the end of the file (answer 416).
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, first, last] = match;
  if (first === "" && last === "") return "invalid";
  if (size === 0) return "invalid";
  if (first === "") {
    // A suffix: the last N bytes.
    const n = Number(last);
    if (!Number.isSafeInteger(n) || n === 0) return "invalid";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(first);
  if (!Number.isSafeInteger(start) || start >= size) return "invalid";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (!Number.isSafeInteger(end) || end < start) return "invalid";
  return { start, end };
}

/** A web stream over `range` of the open file, so it is never read whole. The stream closes the handle when it ends,
 * fails or is cancelled. */
export function streamFile(handle: fsp.FileHandle, range: ByteRange | null): ReadableStream<Uint8Array> {
  const node = handle.createReadStream({ ...(range ? { start: range.start, end: range.end } : {}), autoClose: true });
  return Readable.toWeb(node) as ReadableStream<Uint8Array>;
}
