import { statSync } from "node:fs";
import path from "node:path";
import type { FileSystem } from "../fs/FileSystem";

/** The two disk questions the Spotify-folder rules ask, injectable so tests need no real folders. */
export interface RootProbe {
  isDirectory(target: string): boolean;
  isInside(base: string, target: string): boolean;
}

export function makeRootProbe(fs: Pick<FileSystem, "isInside">): RootProbe {
  return {
    isDirectory(target) {
      try {
        return statSync(target).isDirectory();
      } catch {
        return false;
      }
    },
    isInside: (base, target) => fs.isInside(base, target),
  };
}

/** Where Spotify keeps local files by default; offered as a one-click suggestion (#249). */
export function suggestedAdoptRoot(home: string, current: readonly string[], probe: Pick<RootProbe, "isDirectory">): string | null {
  const candidate = path.join(home, "Documents", "Spotify Music");
  if (current.some((r) => path.resolve(r) === candidate)) return null;
  return probe.isDirectory(candidate) ? candidate : null;
}

/** Null when every root is a folder that sits clear of the library folder, else a user-safe message. */
export function adoptRootsError(roots: readonly string[], libraryDir: string, probe: RootProbe): string | null {
  for (const root of roots) {
    if (!probe.isDirectory(root)) return `Couldn't find a folder at ${root}.`;
    if (probe.isInside(libraryDir, root) || probe.isInside(root, libraryDir)) {
      return "Choose a folder that is not your Locally library folder or inside it.";
    }
  }
  return null;
}
