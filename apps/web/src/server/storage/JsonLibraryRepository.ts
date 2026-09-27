import fs from "node:fs/promises";
import type { Library, Release } from "../../shared/types";
import { libraryFilePath } from "../config/paths";
import type { LibraryRepository } from "./LibraryRepository";

function emptyLibrary(): Library {
  return { version: 1, releases: [] };
}

/**
 * `LibraryRepository` backed by a single `library.json` file inside the
 * library directory. Concurrent read-modify-write calls are serialized with
 * an in-process promise-chain mutex (per library dir) so two overlapping API
 * requests can't clobber each other's write; this only protects against
 * concurrency within this one Node process, which is all a local single-user
 * dev server needs. Writes are atomic (write to a tmp file, then rename).
 */
export class JsonLibraryRepository implements LibraryRepository {
  private locks = new Map<string, Promise<unknown>>();

  private withLock<T>(libraryDir: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(libraryDir) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    // Swallow errors in the chain itself so one failed op doesn't permanently
    // wedge the mutex; the actual error still propagates to the caller via `run`.
    this.locks.set(
      libraryDir,
      run.catch(() => undefined)
    );
    return run;
  }

  private async readRaw(libraryDir: string): Promise<Library> {
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
        await this.writeRaw(libraryDir, lib);
        return lib;
      }
      throw err;
    }
  }

  private async writeRaw(libraryDir: string, library: Library): Promise<void> {
    await fs.mkdir(libraryDir, { recursive: true });
    const file = libraryFilePath(libraryDir);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(library, null, 2), "utf-8");
    await fs.rename(tmp, file);
  }

  async list(libraryDir: string): Promise<Release[]> {
    return this.withLock(libraryDir, async () => (await this.readRaw(libraryDir)).releases);
  }

  async find(libraryDir: string, id: string): Promise<Release | null> {
    const releases = await this.list(libraryDir);
    return releases.find((r) => r.id === id) ?? null;
  }

  async upsert(libraryDir: string, release: Release): Promise<Release> {
    return this.withLock(libraryDir, async () => {
      const lib = await this.readRaw(libraryDir);
      const idx = lib.releases.findIndex((r) => r.id === release.id);
      if (idx >= 0) {
        lib.releases[idx] = release;
      } else {
        lib.releases.push(release);
      }
      await this.writeRaw(libraryDir, lib);
      return release;
    });
  }

  async remove(libraryDir: string, id: string): Promise<Release | null> {
    return this.withLock(libraryDir, async () => {
      const lib = await this.readRaw(libraryDir);
      const idx = lib.releases.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const [removed] = lib.releases.splice(idx, 1);
      await this.writeRaw(libraryDir, lib);
      return removed;
    });
  }
}
