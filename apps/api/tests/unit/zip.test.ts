import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createZipStream, type ZipEntry } from "../../src/server/shares/zip";

function streamOf(data: Buffer, chunk: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= data.length) return controller.close();
      controller.enqueue(new Uint8Array(data.subarray(at, at + chunk)));
      at += chunk;
    },
  });
}

describe("createZipStream", () => {
  it("writes a valid store-only archive that the system unzip accepts", async () => {
    const inputs = [
      { name: "01 - Intro.mp3", data: crypto.randomBytes(300_000) },
      { name: "02 - Outro.m4a", data: crypto.randomBytes(1) },
      { name: "empty.mp3", data: Buffer.alloc(0) },
    ];
    const entries: ZipEntry[] = inputs.map((i) => ({ name: i.name, open: async () => streamOf(i.data, 65_536) }));
    const zip = Buffer.from(await new Response(createZipStream(entries)).arrayBuffer());

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zip-test-"));
    try {
      const file = path.join(dir, "out.zip");
      await fs.writeFile(file, zip);
      const test = spawnSync("unzip", ["-tq", file], { encoding: "utf8" });
      if (test.error) return; // no unzip on this machine; shares.test.ts still parses the archive itself
      expect(test.status, test.stdout + test.stderr).toBe(0);
      const out = path.join(dir, "x");
      expect(spawnSync("unzip", ["-q", file, "-d", out], { encoding: "utf8" }).status).toBe(0);
      for (const i of inputs) expect((await fs.readFile(path.join(out, i.name))).equals(i.data), i.name).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("flags UTF-8 names and the system unzip still reads the archive", async () => {
    const name = "Café – ünï.m4a";
    const zip = Buffer.from(await new Response(createZipStream([{ name, open: async () => streamOf(Buffer.from("abc"), 2) }])).arrayBuffer());
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800); // local header: UTF-8 name flag
    expect(zip.includes(Buffer.from(name, "utf8"))).toBe(true);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zip-test-"));
    try {
      const file = path.join(dir, "u.zip");
      await fs.writeFile(file, zip);
      const test = spawnSync("unzip", ["-tq", file], { encoding: "utf8" });
      if (!test.error) expect(test.status, test.stdout + test.stderr).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("pulls entries lazily and cancels the source when the consumer stops", async () => {
    let opened = 0;
    let cancelled = false;
    const entries: ZipEntry[] = [0, 1].map(() => ({
      name: `${opened}.mp3`,
      open: async () => {
        opened++;
        return new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(10)), cancel: () => void (cancelled = true) });
      },
    }));
    const reader = createZipStream(entries).getReader();
    await reader.read(); // header
    await reader.read(); // first data chunk
    expect(opened).toBe(1);
    await reader.cancel();
    expect(cancelled).toBe(true);
    expect(opened).toBe(1);
  });

  it("errors the stream when a source fails", async () => {
    const entries: ZipEntry[] = [{ name: "a.mp3", open: async () => { throw new Error("gone"); } }];
    await expect(new Response(createZipStream(entries)).arrayBuffer()).rejects.toThrow("gone");
  });
});
