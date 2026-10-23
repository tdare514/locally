import { createReadStream } from "node:fs";
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
  /** The real path, symlinks resolved: what is opened. */
  realPath: string;
  size: number;
  contentType: string;
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
): Promise<TrackAudioFile> {
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

  let bases: string[];
  if (release.adopted) {
    // Only the Spotify folder this release was adopted from: the root that holds its own folder.
    const realFolder = await realOrNull(release.folderPath);
    const roots = (await Promise.all(adoptRoots.map(realOrNull))).filter((r): r is string => r !== null);
    bases = realFolder ? roots.filter((root) => realFolder === root || strictlyBeneath(root, realFolder)) : [];
  } else {
    const realLibrary = await realOrNull(libraryDir);
    bases = realLibrary ? [realLibrary] : [];
  }
  if (!bases.some((base) => strictlyBeneath(base, realFile))) throw new NotFoundError(NOT_FOUND);

  const stat = await fsp.stat(realFile).catch(() => null);
  if (!stat || !stat.isFile()) throw new NotFoundError(NOT_FOUND);
  return { realPath: realFile, size: stat.size, contentType };
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

/** A web stream over `range` of the file, so it is never read whole. A cancelled request closes the file. */
export function streamFile(realPath: string, range: ByteRange | null): ReadableStream<Uint8Array> {
  const node = createReadStream(realPath, range ? { start: range.start, end: range.end } : undefined);
  return Readable.toWeb(node) as ReadableStream<Uint8Array>;
}
