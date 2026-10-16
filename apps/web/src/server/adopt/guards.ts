import path from "node:path";
import { ValidationError } from "../../shared/errors";
import type { Release } from "../../shared/types";
import { adoptedCoversDir } from "../config/paths";
import type { FileSystem } from "../fs/FileSystem";

/**
 * Locally never writes, moves, re-tags or deletes an adopted file (#245). Called first on every path that
 * writes inside a release folder: re-tag, cover replace, delete files, accept, Send.
 */
export function assertWritable(release: Pick<Release, "adopted" | "title">): void {
  if (release.adopted) {
    throw new ValidationError(
      `"${release.title}" was adopted from your Spotify folder and is read-only in Locally. Remove it from Locally to forget it; its files are never changed.`
    );
  }
}

/** True when `target` is strictly beneath `base` (not `base` itself), after realpath, via `fs.isInside`. */
function strictlyInside(fs: FileSystem, base: string, target: string): boolean {
  return fs.isInside(base, target) && path.resolve(target) !== path.resolve(base);
}

/**
 * The read check: a path is readable when it is inside the library folder or inside one of the adopt roots.
 * Both sides are realpathed by `fs.isInside`, so a symlink inside a root that points out of it is refused.
 * Pass an empty `adoptRoots` for a release that is not adopted.
 */
export function isReadablePath(fs: FileSystem, libraryDir: string, adoptRoots: readonly string[], target: string): boolean {
  if (strictlyInside(fs, libraryDir, target)) return true;
  return adoptRoots.some((root) => strictlyInside(fs, root, target));
}

export function assertReadablePath(
  fs: FileSystem,
  libraryDir: string,
  adoptRoots: readonly string[],
  target: string,
  message = "Refusing to read a file outside the library and the adopted folders"
): void {
  if (!isReadablePath(fs, libraryDir, adoptRoots, target)) throw new ValidationError(message);
}

/** An adopted release's cover is a copy in Locally's app data, never a file in an adopt root. */
export function isAdoptedCoverPath(fs: FileSystem, target: string): boolean {
  return strictlyInside(fs, adoptedCoversDir(), target);
}
