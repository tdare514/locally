import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublicError } from "../../src/shared/errors";
import { FfmpegConverter } from "../../src/server/audio/FfmpegConverter";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-ffmpeg-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Write an executable shell script standing in for `ffmpeg` and return its path. */
async function writeFakeBinary(name: string, script: string): Promise<string> {
  const binPath = path.join(tmpDir, name);
  await fs.writeFile(binPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return binPath;
}

describe("FfmpegConverter.toMp3", () => {
  it("passes -nostdin, a file-only protocol whitelist, and -f mp3 to ffmpeg", async () => {
    const argsFile = path.join(tmpDir, "args.txt");
    // Dumps its argv (one per line) to argsFile, then exits 0 without touching
    // the real output path (the test only cares about the invocation).
    const binPath = await writeFakeBinary(
      "fake-ffmpeg",
      `for a in "$@"; do echo "$a" >> "${argsFile}"; done\nexit 0`
    );

    const input = path.join(tmpDir, "input.wav");
    const output = path.join(tmpDir, "out", "output.mp3");
    await fs.writeFile(input, "not really audio");

    const converter = new FfmpegConverter(binPath);
    await converter.toMp3(input, output);

    const args = (await fs.readFile(argsFile, "utf-8")).trim().split("\n");
    expect(args[0]).toBe("-nostdin");
    expect(args).toContain("-protocol_whitelist");
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("file");
    expect(args).toContain("-f");
    expect(args[args.indexOf("-f") + 1]).toBe("mp3");
    // -protocol_whitelist must precede -i (the input), not follow it.
    expect(args.indexOf("-protocol_whitelist")).toBeLessThan(args.indexOf("-i"));
  });

  it("kills a hung ffmpeg process after the configured timeout and rejects with PublicError", async () => {
    // `exec` replaces the shell with `sleep` in place (same pid, no forked
    // child holding the stdio pipes open) so SIGKILL to the spawned process
    // actually ends it - closer to how a real ffmpeg process behaves.
    const binPath = await writeFakeBinary("fake-ffmpeg-hang", "exec sleep 30");

    const input = path.join(tmpDir, "input.wav");
    const output = path.join(tmpDir, "out", "output.mp3");
    await fs.writeFile(input, "not really audio");

    const converter = new FfmpegConverter(binPath, 200);

    await expect(converter.toMp3(input, output)).rejects.toBeInstanceOf(PublicError);
    await expect(converter.toMp3(input, output)).rejects.toThrow(/timed out/);
  }, 10000);

  it("still copies .mp3 input directly without invoking ffmpeg", async () => {
    const input = path.join(tmpDir, "input.mp3");
    const output = path.join(tmpDir, "out", "output.mp3");
    await fs.writeFile(input, "mp3 bytes");

    // A binary that would fail loudly if ever invoked, proving the .mp3
    // fast-path never shells out.
    const binPath = await writeFakeBinary("fake-ffmpeg-should-not-run", "exit 1");
    const converter = new FfmpegConverter(binPath);
    await converter.toMp3(input, output);

    expect(await fs.readFile(output, "utf-8")).toBe("mp3 bytes");
  });
});
