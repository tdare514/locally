import { statSync } from "node:fs";
import path from "node:path";
import { NodeFileSystem } from "../fs/NodeFileSystem";

/** The two disk questions the Spotify-folder rules ask, injectable so tests need no real folders. */
export interface RootProbe {
  isDirectory(target: string): boolean;
  /** The canonical path (symlinks resolved), with any missing tail segments kept. */
  realpath(target: string): string;
}

const fsShared = new NodeFileSystem();

export function makeRootProbe(): RootProbe {
  return {
    isDirectory(target) {
      try {
        return statSync(target).isDirectory();
      } catch {
        return false;
      }
    },
    // Deepest existing ancestor resolved, missing tail re-appended: a library that does not exist yet
    // under a symlink still lands on its real place.
    realpath: (target) => fsShared.realAncestorPath(target),
  };
}

/** Where Spotify keeps local files by default; offered as a one-click suggestion (#249). */
export function suggestedAdoptRoot(home: string, current: readonly string[], probe: Pick<RootProbe, "isDirectory">): string | null {
  const candidate = path.join(home, "Documents", "Spotify Music");
  if (current.some((r) => path.resolve(r) === candidate)) return null;
  return probe.isDirectory(candidate) ? candidate : null;
}

function inside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type RootsCheck = { ok: true; roots: string[] } | { ok: false; error: string };

/**
 * Canonicalises `requested` (realpath, de-duplicated) and checks it against the library folder, also by
 * realpath, so a symlink alias cannot slip past. Only roots that are not already saved must exist: a
 * saved folder that has gone missing can still be kept or removed. Returns the canonical roots to store.
 */
export function checkAdoptRoots(
  requested: readonly string[],
  saved: readonly string[],
  libraryDir: string,
  probe: RootProbe
): RootsCheck {
  const library = probe.realpath(libraryDir);
  const known = new Set(saved.flatMap((r) => [path.resolve(r), probe.realpath(r)]));
  const out: string[] = [];
  for (const raw of requested) {
    const resolved = path.resolve(raw);
    const isNew = !known.has(resolved) && !known.has(probe.realpath(resolved));
    if (isNew && !probe.isDirectory(resolved)) return { ok: false, error: `Couldn't find a folder at ${resolved}.` };
    const root = probe.realpath(resolved);
    if (inside(library, root) || inside(root, library)) {
      return { ok: false, error: "Choose a folder that is not your Locally library folder or inside it." };
    }
    if (!out.includes(root)) out.push(root);
  }
  return { ok: true, roots: out };
}
