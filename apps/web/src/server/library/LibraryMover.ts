import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PublicError, ValidationError } from "../../shared/errors";
import type { Release } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { NodeFileSystem } from "../fs/NodeFileSystem";
import type { LibraryRepository } from "../storage/LibraryRepository";
import { clearJournal, MOVE_PROBLEM_MESSAGE, readJournal, setMoveProblem, writeJournal, type MoveJournal } from "./LibraryMoveJournal";
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
export async function libraryNotMovableReason(
  deps: Pick<MoveLibraryDeps, "fs" | "home" | "dataDir">,
  libraryDir: string,
  adoptRoots: readonly string[]
): Promise<string | null> {
  const lib = deps.fs.realAncestorPath(path.resolve(libraryDir));
  const home = deps.fs.realAncestorPath(deps.home);
  if (lib === home || path.dirname(lib) === home) return BROAD_LIBRARY_REASON;
  if (within(lib, deps.fs.realAncestorPath(deps.dataDir))) return BROAD_LIBRARY_REASON;
  if (adoptRoots.some((r) => within(lib, deps.fs.realAncestorPath(path.resolve(r))))) return BROAD_LIBRARY_REASON;
  if (await hasSymlink(libraryDir)) return SYMLINK_REASON;
  return null;
}

export const SYMLINK_REASON = "Your library folder has shortcuts (symlinks) in it, so Locally won't move it.";

/** True when anything in the tree is a symlink (a missing folder has none). */
export async function hasSymlink(dir: string): Promise<boolean> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) return true;
    if (e.isDirectory() && (await hasSymlink(path.join(dir, e.name)))) return true;
  }
  return false;
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

async function isDir(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}

async function isEmptyDir(p: string): Promise<boolean> {
  return fs.readdir(p).then((n) => n.length === 0, () => false);
}

/** Every file of `src` is in `dst` with the same size and SHA-256. The library index at the top is skipped: the move rewrites it. */
export async function treeMatches(src: string, dst: string, top = true): Promise<boolean> {
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (top && entry.name === "library.json") continue;
    const a = path.join(src, entry.name);
    const b = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (!(await treeMatches(a, b, false))) return false;
    } else if (entry.isFile()) {
      const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b).catch(() => null)]);
      if (!sb || sa.size !== sb.size) return false;
      if ((await sha256(a)) !== (await sha256(b))) return false;
    } else {
      return false;
    }
  }
  return true;
}

async function rewriteIndex(deps: Pick<MoveLibraryDeps, "library">, dir: string, from: string, to: string): Promise<void> {
  for (const release of await deps.library.list(dir)) {
    await deps.library.upsert(dir, rebaseRelease(release, from, to));
  }
}

/** Points settings at `to`. True when they now do (or already did); false when they name some other folder. */
async function switchSettings(deps: Pick<MoveLibraryDeps, "settings">, from: string, to: string): Promise<boolean> {
  let ok = false;
  await deps.settings.update((s) => {
    const cur = path.resolve(s.libraryDir);
    if (cur === to) {
      ok = true;
      return null;
    }
    if (cur !== from) return null;
    ok = true;
    return { ...s, libraryDir: to, spotifySourceDismissed: false };
  });
  return ok;
}

/** Puts a failed move back. Returns what went wrong; every error is reported, none swallowed. */
async function rollbackMove(deps: Pick<MoveLibraryDeps, "library">, j: MoveJournal, renamed: boolean): Promise<string[]> {
  const errors: string[] = [];
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  if (renamed) {
    await attempt("restoring the index", () => rewriteIndex(deps, j.to, j.to, j.from));
    await attempt("renaming the folder back", () => fs.rename(j.to, j.from));
  } else if (j.toCreated) {
    await attempt("removing the partial copy", () => fs.rm(j.to, { recursive: true, force: true }));
  } else {
    await attempt("emptying the partial copy", async () => {
      if (await isDir(j.to)) await emptyOut(j.to);
    });
  }
  return errors;
}

/**
 * Moves the library folder to `destination` (#335): a rename on one volume, else a verified copy and then
 * removal of the old tree. Rewrites absolute paths in the index and switches `libraryDir`. A journal in the
 * data folder is written first and kept until the end, so a crash can be put right (`recoverLibraryMove`).
 * A failure before the switch puts everything back; if that fails too the journal stays and the error says so.
 */
export async function moveLibrary(deps: MoveLibraryDeps, destination: unknown): Promise<MoveResult> {
  return runLibraryMove(async () => {
    if ((await readJournal(deps.dataDir)) !== null) {
      throw new ValidationError("An earlier move of your library didn't finish. Restart Locally to finish it, or contact support.");
    }
    const current = await deps.settings.get();
    const from = path.resolve(current.libraryDir);
    const broad = await libraryNotMovableReason(deps, from, current.adoptRoots ?? []);
    if (broad) throw new ValidationError(broad);
    const to = await validateDestination(deps, from, destination);
    await fs.stat(from).catch(() => {
      throw new ValidationError("Your current library folder can't be found, so there is nothing to move.");
    });
    const counts = movableCounts(await deps.library.list(from), from);

    await fs.mkdir(path.dirname(to), { recursive: true });
    const crossVolume = deps.forceCrossVolume ?? !(await sameVolume(from, to));
    const toExisted = await isDir(to);
    const journal: MoveJournal = { from, to, mode: crossVolume ? "copy" : "rename", phase: "moving", toCreated: !toExisted };
    await writeJournal(deps.dataDir, journal);

    let renamed = false;
    try {
      if (journal.mode === "rename") {
        try {
          await fs.rename(from, to);
          renamed = true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
          journal.mode = "copy";
          await writeJournal(deps.dataDir, journal);
        }
      }
      if (!renamed) await copyTreeVerified(from, to);
      journal.phase = "moved";
      await writeJournal(deps.dataDir, journal);
      await rewriteIndex(deps, to, from, to);
      journal.phase = "indexed";
      await writeJournal(deps.dataDir, journal);
      if (!(await switchSettings(deps, from, to))) {
        throw new ValidationError("The library folder changed while moving. Nothing was moved.");
      }
    } catch (err) {
      const errors = await rollbackMove(deps, journal, renamed);
      if (errors.length > 0) {
        throw new PublicError(
          `Couldn't move your library, and couldn't fully undo it (${errors.join("; ")}). Nothing was deleted from ${from}. Please contact support. First error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      await clearJournal(deps.dataDir);
      throw err;
    }
    journal.phase = "switched";
    await writeJournal(deps.dataDir, journal).catch((e) => console.warn("Could not update the move journal:", e));

    let oldRemoved = true;
    if (!renamed) {
      oldRemoved = await fs.rm(from, { recursive: true, force: true }).then(() => true, () => false);
    }
    await clearJournal(deps.dataDir);
    return { from, to, ...counts, oldRemoved };
  });
}

export type RecoveryOutcome = "none" | "finished" | "rolled-back" | "unclear";

/**
 * Start-up recovery for a move that did not finish (#335). Run before the library is read. Finishes a move whose
 * files are at `to`, rolls back one whose files are still at `from` (removing `to` only when that move made it),
 * and in any unclear state leaves every file and the journal alone and records a problem for Settings to show.
 */
export async function recoverLibraryMove(deps: Pick<MoveLibraryDeps, "settings" | "library" | "dataDir">): Promise<RecoveryOutcome> {
  const unclear = (why: string): RecoveryOutcome => {
    console.warn(`Library move recovery: ${why}. Leaving the files and the journal alone.`);
    setMoveProblem(MOVE_PROBLEM_MESSAGE);
    return "unclear";
  };
  setMoveProblem(null);
  const j = await readJournal(deps.dataDir);
  if (j === null) return "none";
  if (j === "corrupt") return unclear("the journal can't be read");
  const { from, to } = j;
  if (within(from, to) || within(to, from)) return unclear("the journal's folders overlap");
  try {
    const cur = path.resolve((await deps.settings.get()).libraryDir);
    const at = cur === from ? "from" : cur === to ? "to" : "other";
    if (at === "other") return unclear("settings name neither folder");
    const fromEx = await isDir(from);
    const toEx = await isDir(to);
    const done = async (outcome: RecoveryOutcome): Promise<RecoveryOutcome> => {
      await clearJournal(deps.dataDir);
      return outcome;
    };
    const finishForward = async (removeOld: boolean): Promise<RecoveryOutcome> => {
      await rewriteIndex(deps, to, from, to);
      if (!(await switchSettings(deps, from, to))) return unclear("settings changed during recovery");
      if (removeOld && fromEx) await fs.rm(from, { recursive: true, force: true });
      return done("finished");
    };

    if (j.mode === "rename") {
      if (!fromEx && toEx) return finishForward(false);
      if (fromEx && at === "from" && (!toEx || (await isEmptyDir(to)))) {
        // The rename never happened. Only an empty folder this move made is removed.
        if (toEx && j.toCreated) await fs.rmdir(to);
        return done("rolled-back");
      }
      return unclear("both folders or neither hold files");
    }

    // copy mode
    if (at === "to") {
      if (!fromEx) return done("finished");
      if (toEx && (await treeMatches(from, to))) {
        await fs.rm(from, { recursive: true, force: true });
        return done("finished");
      }
      return unclear("the copy does not match the old folder");
    }
    if (!fromEx) return unclear("the old folder is missing and settings still name it");
    if (j.phase !== "moving" && toEx && (await treeMatches(from, to))) return finishForward(true);
    if (!toEx) return done("rolled-back");
    if (!j.toCreated) return unclear("a partial copy sits in a folder this move did not create");
    await fs.rm(to, { recursive: true, force: true });
    return done("rolled-back");
  } catch (err) {
    return unclear(err instanceof Error ? err.message : String(err));
  }
}
