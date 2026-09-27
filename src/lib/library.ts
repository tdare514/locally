import fs from "node:fs/promises";
import type { Library, Release } from "./types";
import { libraryFilePath } from "./paths";

/**
 * Simple in-process mutex implemented as a promise chain, so that concurrent
 * read-modify-write operations against library.json don't clobber each other.
 * This only protects against concurrent writes from within this Node process
 * (fine for a local single-user dev server).
 */
let mutex: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  // Swallow errors in the chain itself so one failed op doesn't permanently
  // wedge the mutex; the actual error still propagates to the caller via `run`.
  mutex = run.catch(() => undefined);
  return run;
}

function emptyLibrary(): Library {
  return { version: 1, releases: [] };
}

async function readLibraryRaw(libraryDir: string): Promise<Library> {
  const file = libraryFilePath(libraryDir);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Library>;
    if (!parsed || !Array.isArray(parsed.releases)) {
      return emptyLibrary();
    }
    return { version: 1, releases: parsed.releases };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      const lib = emptyLibrary();
      await writeLibraryRaw(libraryDir, lib);
      return lib;
    }
    throw err;
  }
}

async function writeLibraryRaw(libraryDir: string, library: Library): Promise<void> {
  await fs.mkdir(libraryDir, { recursive: true });
  const file = libraryFilePath(libraryDir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(library, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

/** Read the library index (creating an empty one if missing). Not locked (read-only). */
export async function readLibrary(libraryDir: string): Promise<Library> {
  return withLock(() => readLibraryRaw(libraryDir));
}

/** Insert or replace a release by id. */
export async function upsertRelease(libraryDir: string, release: Release): Promise<Library> {
  return withLock(async () => {
    const lib = await readLibraryRaw(libraryDir);
    const idx = lib.releases.findIndex((r) => r.id === release.id);
    if (idx >= 0) {
      lib.releases[idx] = release;
    } else {
      lib.releases.push(release);
    }
    await writeLibraryRaw(libraryDir, lib);
    return lib;
  });
}

/** Remove a release by id. Returns the removed release, or null if not found. */
export async function removeRelease(libraryDir: string, id: string): Promise<Release | null> {
  return withLock(async () => {
    const lib = await readLibraryRaw(libraryDir);
    const idx = lib.releases.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const [removed] = lib.releases.splice(idx, 1);
    await writeLibraryRaw(libraryDir, lib);
    return removed;
  });
}

/** Find a release by id without locking (read-only lookup). */
export async function findRelease(libraryDir: string, id: string): Promise<Release | null> {
  const lib = await readLibrary(libraryDir);
  return lib.releases.find((r) => r.id === id) ?? null;
}

/** Run an arbitrary read-modify-write against the library under the mutex. */
export async function withLibrary<T>(
  libraryDir: string,
  fn: (lib: Library) => Promise<T> | T
): Promise<T> {
  return withLock(async () => {
    const lib = await readLibraryRaw(libraryDir);
    const result = await fn(lib);
    await writeLibraryRaw(libraryDir, lib);
    return result;
  });
}
