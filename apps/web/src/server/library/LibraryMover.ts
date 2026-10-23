import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../../shared/errors";
import type { Release } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { NodeFileSystem } from "../fs/NodeFileSystem";
import type { LibraryRepository } from "../storage/LibraryRepository";
import { runLibraryMove } from "./writeActivity";

export interface MoveLibraryDeps {
  settings: SettingsStore;
  library: LibraryRepository;
  fs: Pick<NodeFileSystem, "realAncestorPath">;
  /** The user's home folder: the destination must be under it. */
  home: string;
  /** Locally's own data folder (settings, sync state): never a destination. */
  dataDir: string;
  /** Test hook: true forces the copy-and-verify path, false the rename path. Default: decided from the disk. */
  forceCrossVolume?: boolean;
}

export interface MoveResult {
  from: string;
  to: string;
  releases: number;
  songs: number;
  /** False when the copy was verified and in use but the old tree could not be deleted. */
  oldRemoved: boolean;
}

function within(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Releases whose files Locally wrote into the library folder (adopted ones stay where they are). */
export function movableCounts(releases: readonly Release[], libraryDir: string): { releases: number; songs: number } {
  const own = releases.filter((r) => !r.adopted && within(libraryDir, r.folderPath));
  return { releases: own.length, songs: own.reduce((n, r) => n + r.tracks.length, 0) };
}

export const BROAD_LIBRARY_REASON =
  "Your library folder also holds other things, so Locally won't move it. Choose a folder that only holds your Locally music.";

/**
 * Null when the whole current library folder may be moved; else the reason it may not. A folder that is home, a
 * direct child of home (~/Music, ~/Documents), or that holds Locally's data or a Spotify folder holds more than music.
 */
export function libraryNotMovableReason(
  deps: Pick<MoveLibraryDeps, "fs" | "home" | "dataDir">,
  libraryDir: string,
  adoptRoots: readonly string[]
): string | null {
  const lib = deps.fs.realAncestorPath(path.resolve(libraryDir));
  const home = deps.fs.realAncestorPath(deps.home);
  if (lib === home || path.dirname(lib) === home) return BROAD_LIBRARY_REASON;
  if (within(lib, deps.fs.realAncestorPath(deps.dataDir))) return BROAD_LIBRARY_REASON;
  if (adoptRoots.some((r) => within(lib, deps.fs.realAncestorPath(path.resolve(r))))) return BROAD_LIBRARY_REASON;
  return null;
}

/** The checks on a destination; returns the resolved path or throws a ValidationError that is safe to show. */
export async function validateDestination(deps: MoveLibraryDeps, libraryDir: string, destination: unknown): Promise<string> {
  if (typeof destination !== "string" || destination.trim().length === 0 || !path.isAbsolute(destination)) {
    throw new ValidationError("The new folder must be an absolute path, starting with /.");
  }
  const dest = path.resolve(destination);
  const real = deps.fs.realAncestorPath(dest);
  const home = deps.fs.realAncestorPath(deps.home);
  if (real === home || !within(home, real)) throw new ValidationError("The new folder must be inside your home folder.");
  if (within(deps.fs.realAncestorPath(libraryDir), real) || within(libraryDir, dest)) {
    throw new ValidationError("The new folder can't be your current library folder or inside it.");
  }
  if (within(deps.fs.realAncestorPath(deps.dataDir), real) || within(deps.dataDir, dest)) {
    throw new ValidationError("The new folder can't be inside Locally's own data folder.");
  }
  let st;
  try {
    st = await fs.stat(dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return dest;
    throw err;
  }
  if (!st.isDirectory()) throw new ValidationError("Something that isn't a folder is already there.");
  if ((await fs.readdir(dest)).length > 0) throw new ValidationError("That folder isn't empty. Choose a new folder or an empty one.");
  return dest;
}

async function nearestExisting(p: string): Promise<string> {
  let cur = p;
  for (;;) {
    try {
      await fs.stat(cur);
      return cur;
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return cur;
      cur = up;
    }
  }
}

async function sameVolume(a: string, b: string): Promise<boolean> {
  return (await fs.stat(a)).dev === (await fs.stat(await nearestExisting(b))).dev;
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (c) => h.update(c)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** Copies `src` into `dest` and checks every file's size and SHA-256 against the original. Throws on any difference. */
export async function copyTreeVerified(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTreeVerified(from, to);
    } else if (entry.isSymbolicLink()) {
      await fs.symlink(await fs.readlink(from), to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
      const [a, b] = await Promise.all([fs.stat(from), fs.stat(to)]);
      if (a.size !== b.size) throw new Error(`Size differs after copying ${entry.name}`);
      const [ha, hb] = await Promise.all([sha256(from), sha256(to)]);
      if (ha !== hb) throw new Error(`Checksum differs after copying ${entry.name}`);
    }
  }
}

function rebase(p: string, from: string, to: string): string {
  return within(from, p) ? path.join(to, path.relative(from, p)) : p;
}

function rebaseRelease(r: Release, from: string, to: string): Release {
  return {
    ...r,
    folderPath: rebase(r.folderPath, from, to),
    coverPath: r.coverPath ? rebase(r.coverPath, from, to) : r.coverPath,
    tracks: r.tracks.map((t) => ({ ...t, filePath: rebase(t.filePath, from, to) })),
  };
}

async function emptyOut(dir: string): Promise<void> {
  for (const name of await fs.readdir(dir)) await fs.rm(path.join(dir, name), { recursive: true, force: true });
}

/**
 * Moves the library folder to `destination` (#335): a rename on one volume, else a verified copy and then
 * removal of the old tree. Rewrites absolute paths in the index and switches `libraryDir`. All or nothing:
 * a failure before the switch puts everything back.
 */
export async function moveLibrary(deps: MoveLibraryDeps, destination: unknown): Promise<MoveResult> {
  return runLibraryMove(async () => {
    const current = await deps.settings.get();
    const from = path.resolve(current.libraryDir);
    const broad = libraryNotMovableReason(deps, from, current.adoptRoots ?? []);
    if (broad) throw new ValidationError(broad);
    const to = await validateDestination(deps, from, destination);
    await fs.stat(from).catch(() => {
      throw new ValidationError("Your current library folder can't be found, so there is nothing to move.");
    });
    const counts = movableCounts(await deps.library.list(from), from);

    await fs.mkdir(path.dirname(to), { recursive: true });
    const crossVolume = deps.forceCrossVolume ?? !(await sameVolume(from, to));
    let renamed = false;
    const toExisted = await fs.stat(to).then(() => true, () => false);
    if (!crossVolume) {
      try {
        await fs.rename(from, to);
        renamed = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      }
    }
    if (!renamed) {
      try {
        await copyTreeVerified(from, to);
      } catch (err) {
        if (toExisted) await emptyOut(to).catch(() => undefined);
        else await fs.rm(to, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
    }

    const undo = async () => {
      if (renamed) {
        for (const release of await deps.library.list(to).catch(() => [])) {
          await deps.library.upsert(to, rebaseRelease(release, to, from)).catch(() => undefined);
        }
        await fs.rename(to, from).catch(() => undefined);
      } else if (toExisted) await emptyOut(to).catch(() => undefined);
      else await fs.rm(to, { recursive: true, force: true }).catch(() => undefined);
    };
    try {
      for (const release of await deps.library.list(to)) {
        await deps.library.upsert(to, rebaseRelease(release, from, to));
      }
      let switched = false;
      await deps.settings.update((s) => {
        if (path.resolve(s.libraryDir) !== from) return null;
        switched = true;
        return { ...s, libraryDir: to, spotifySourceDismissed: false };
      });
      if (!switched) throw new ValidationError("The library folder changed while moving. Nothing was moved.");
    } catch (err) {
      await undo();
      throw err;
    }

    let oldRemoved = true;
    if (!renamed) {
      oldRemoved = await fs.rm(from, { recursive: true, force: true }).then(() => true, () => false);
    }
    return { from, to, ...counts, oldRemoved };
  });
}
