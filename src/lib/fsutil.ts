import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Stream a web `File`/`Blob` to disk at `destPath` (parent dir created if missing). */
export async function saveWebFileToDisk(file: File, destPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const webStream = file.stream() as unknown as ReadableStream<Uint8Array>;
  const nodeReadable = Readable.fromWeb(webStream as never);
  const out = createWriteStream(destPath);
  await pipeline(nodeReadable, out);
}

/** Create and return a fresh unique temp directory under the OS temp dir. */
export async function makeTempDir(prefix = "sli-"): Promise<string> {
  const base = path.join(os.tmpdir(), `${prefix}${crypto.randomUUID()}`);
  await fs.mkdir(base, { recursive: true });
  return base;
}

/**
 * Move a file from src to dest, falling back to copy+unlink if rename fails
 * (e.g. EXDEV across devices/filesystems).
 */
export async function safeMove(src: string, dest: string): Promise<void> {
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

/** Recursively remove a file or directory; no-op if it doesn't exist. */
export async function removeRecursive(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

/**
 * Return `desired` if it does not exist yet, otherwise `desired (2)`, `desired (3)`, ...
 * Prevents two releases with the same artist/album from sharing (and later deleting) one folder.
 */
export async function uniqueDir(desired: string): Promise<string> {
  const exists = async (p: string) => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };
  if (!(await exists(desired))) return desired;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${desired} (${n})`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Could not find a free folder name");
}

/** True when `target` resolves to `base` or somewhere beneath it. */
export function isInside(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
