import fs from "node:fs/promises";
import type { Library, Release } from "../../shared/types";
import { libraryFilePath } from "../config/paths";
import type { LibraryRepository } from "./LibraryRepository";
import { ReleaseSchema } from "./releaseSchema";

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
  // `libraryDir:id-or-index` keys already warned about, so a malformed entry logs once
  // rather than on every list()/find() call for as long as this process runs.
  private warnedBadEntries = new Set<string>();

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
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        const lib = emptyLibrary();
        await this.writeRaw(libraryDir, lib);
        return lib;
      }
      throw err;
    }

    let parsed: Partial<Library> | null;
    try {
      parsed = JSON.parse(raw) as Partial<Library>;
    } catch {
      // Truncated write, disk corruption, or a hand-edit gone wrong: never let this wedge
      // every list/find call forever. Move the bad file aside for forensics and start fresh,
      // the same recovery as a missing file.
      const corruptPath = `${file}.corrupt-${Date.now()}`;
      console.warn(`JsonLibraryRepository: ${file} is not valid JSON; moving it to ${corruptPath}`);
      await fs.rename(file, corruptPath);
      const lib = emptyLibrary();
      await this.writeRaw(libraryDir, lib);
      return lib;
    }

    if (!parsed || !Array.isArray(parsed.releases)) {
      return emptyLibrary();
    }
    return { version: 1, releases: parsed.releases };
  }

  private async writeRaw(libraryDir: string, library: Library): Promise<void> {
    await fs.mkdir(libraryDir, { recursive: true });
    const file = libraryFilePath(libraryDir);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(library, null, 2), "utf-8");
    await fs.rename(tmp, file);
  }

  /**
   * `readRaw().releases` is untrusted (hand-edited file, a future/older schema version, sync
   * writing a network-sourced record): validate each entry against `ReleaseSchema` and drop -
   * rather than crash the whole list on - anything that doesn't match, logging once per bad
   * entry. `upsert`/`remove` deliberately bypass this and work on `readRaw`'s array directly, so
   * a malformed entry is never silently dropped from the file itself by an unrelated write.
   */
  private validReleases(raw: unknown[], libraryDir: string): Release[] {
    const out: Release[] = [];
    raw.forEach((entry, index) => {
      const result = ReleaseSchema.safeParse(entry);
      if (result.success) {
        out.push(result.data as Release);
        return;
      }
      const id = typeof (entry as { id?: unknown })?.id === "string" ? (entry as { id: string }).id : `#${index}`;
      const key = `${libraryDir}:${id}`;
      if (!this.warnedBadEntries.has(key)) {
        this.warnedBadEntries.add(key);
        console.warn(`JsonLibraryRepository: skipping malformed release entry ${id} in ${libraryDir}`);
      }
    });
    return out;
  }

  async list(libraryDir: string): Promise<Release[]> {
    return this.withLock(libraryDir, async () => {
      const lib = await this.readRaw(libraryDir);
      return this.validReleases(lib.releases, libraryDir);
    });
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
