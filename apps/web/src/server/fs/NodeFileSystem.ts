import { createWriteStream, existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FileSystem } from "./FileSystem";

/** `FileSystem` implemented against `node:fs`. The only place raw disk I/O lives. */
export class NodeFileSystem implements FileSystem {
  async saveWebFile(file: File, destPath: string): Promise<void> {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const webStream = file.stream() as unknown as ReadableStream<Uint8Array>;
    const nodeReadable = Readable.fromWeb(webStream as never);
    const out = createWriteStream(destPath);
    await pipeline(nodeReadable, out);
  }

  async makeTempDir(prefix = "sli-"): Promise<string> {
    const base = path.join(os.tmpdir(), `${prefix}${crypto.randomUUID()}`);
    await fs.mkdir(base, { recursive: true });
    return base;
  }

  async safeMove(src: string, dest: string): Promise<void> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(src, dest);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EXDEV") {
        await fs.copyFile(src, dest);
        await fs.unlink(src);
      } else {
        throw err;
      }
    }
  }

  async removeRecursive(target: string): Promise<void> {
    await fs.rm(target, { recursive: true, force: true });
  }

  async uniqueDir(desired: string): Promise<string> {
    if (!(await this.exists(desired))) return desired;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${desired} (${n})`;
      if (!(await this.exists(candidate))) return candidate;
    }
    throw new Error("Could not find a free folder name");
  }

  isInside(base: string, target: string): boolean {
    // Lexical check first: cheap, and rejects the common cases (traversal segments,
    // unrelated siblings) without touching disk.
    if (!this.isInsideLexical(base, target)) return false;
    // A symlink the user placed inside the library can lexically look like a child
    // while actually resolving somewhere else entirely, so also compare real paths.
    // Both sides are realpath'd (not just the target): on macOS `/tmp` itself is a
    // symlink to `/private/tmp`, and comparing a realpath'd target against a
    // lexical base would then wrongly reject paths under a tmp-dir library in tests.
    const realBase = this.realpathOrSelf(path.resolve(base));
    const realTarget = this.realAncestorPath(target);
    return this.isInsideLexical(realBase, realTarget);
  }

  private isInsideLexical(base: string, target: string): boolean {
    const rel = path.relative(path.resolve(base), path.resolve(target));
    // "" is base itself; callers that must exclude it (delete) do so explicitly.
    if (rel === "") return true;
    // Absolute means a different drive (Windows). Otherwise only a leading ".." segment
    // escapes: a plain prefix test would wrongly reject a child named "..foo".
    return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
  }

  private realpathOrSelf(resolved: string): string {
    try {
      return existsSync(resolved) ? realpathSync.native(resolved) : resolved;
    } catch {
      return resolved;
    }
  }

  /**
   * Real path of `target`'s deepest existing ancestor, with the non-existent
   * tail segments (if any) re-appended untouched. `target` itself usually
   * doesn't exist yet (a not-yet-written track/cover path), so plain
   * `realpathSync` would throw; walking up to what does exist lets a symlinked
   * ancestor still be caught while a merely-not-yet-created path isn't rejected.
   */
  private realAncestorPath(target: string): string {
    let current = path.resolve(target);
    const tail: string[] = [];
    for (;;) {
      if (existsSync(current)) break;
      const parent = path.dirname(current);
      if (parent === current) break; // reached the filesystem root without finding anything
      tail.unshift(path.basename(current));
      current = parent;
    }
    const real = this.realpathOrSelf(current);
    return tail.length > 0 ? path.join(real, ...tail) : real;
  }

  async mkdirp(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  async readFile(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  async statSize(filePath: string): Promise<number> {
    const stat = await fs.stat(filePath);
    return stat.size;
  }
}
