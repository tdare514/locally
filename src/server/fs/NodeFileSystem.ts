import { createWriteStream } from "node:fs";
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
    const rel = path.relative(path.resolve(base), path.resolve(target));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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
}
