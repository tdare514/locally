/**
 * All filesystem side effects `ReleaseService`/`InspectService` need, behind
 * one interface. Lets tests swap in fakes without a real disk, and keeps
 * `node:fs` usage in one implementation instead of scattered across services.
 */
export interface FileSystem {
  /** Stream a web `File`/`Blob` to disk at `destPath` (parent dir created if missing). */
  saveWebFile(file: File, destPath: string): Promise<void>;
  /** Create and return a fresh unique temp directory under the OS temp dir. */
  makeTempDir(prefix?: string): Promise<string>;
  /**
   * Move a file from src to dest, falling back to copy+unlink if rename fails
   * (e.g. EXDEV across devices/filesystems).
   */
  safeMove(src: string, dest: string): Promise<void>;
  /** Recursively remove a file or directory; no-op if it doesn't exist. */
  removeRecursive(target: string): Promise<void>;
  /**
   * Return `desired` if it does not exist yet, otherwise `desired (2)`,
   * `desired (3)`, ... Prevents two releases with the same artist/album from
   * sharing (and later deleting) one folder.
   */
  uniqueDir(desired: string): Promise<string>;
  /** True when `target` resolves to `base` or somewhere beneath it. */
  isInside(base: string, target: string): boolean;
  /** Create a directory (and parents) if missing. */
  mkdirp(dir: string): Promise<void>;
  /** Read a whole file into a Buffer. */
  readFile(filePath: string): Promise<Buffer>;
  /** True if a path exists on disk. */
  exists(target: string): Promise<boolean>;
  /** Size in bytes of a file on disk, without reading its contents. */
  statSize(filePath: string): Promise<number>;
}
