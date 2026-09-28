import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PublicError } from "../../shared/errors";
import type { AudioConverter } from "./AudioConverter";

/**
 * `AudioConverter` implemented by shelling out to the system `ffmpeg` binary
 * (never via a shell string — always an argument array, so user-controlled
 * filenames can't be interpreted as shell syntax). The binary name is
 * injectable so tests (or an alternate install location) can override it.
 */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class FfmpegConverter implements AudioConverter {
  constructor(
    private readonly binary: string = "ffmpeg",
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  async toMp3(inputPath: string, outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    if (path.extname(inputPath).toLowerCase() === ".mp3") {
      await fs.copyFile(inputPath, outputPath);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.binary, [
        // Never wait on stdin: this always runs unattended, and a hung read
        // would tie up the watchdog for nothing.
        "-nostdin",
        "-y",
        // Only the local file protocol is needed to read `inputPath`; this
        // stops a crafted input (e.g. a concat-demuxer playlist) from making
        // ffmpeg reach out to a network or pipe protocol instead.
        "-protocol_whitelist",
        "file",
        "-i",
        inputPath,
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "320k",
        // Force the container/muxer rather than inferring it from
        // `outputPath`'s extension, which is always ".mp3" but shouldn't be
        // load-bearing for what ffmpeg decides to write.
        "-f",
        "mp3",
        outputPath,
      ]);

      let stderr = "";
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      // Watchdog: a stuck or maliciously slow input must not hang the import
      // forever. SIGKILL rather than SIGTERM - ffmpeg can catch and ignore
      // SIGTERM while still reading input.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, this.timeoutMs);

      proc.on("error", (err) => {
        clearTimeout(timer);
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === "ENOENT") {
          reject(
            new PublicError(
              `${this.binary} was not found on PATH. Install ffmpeg (e.g. \`brew install ffmpeg\`) and try again.`
            )
          );
        } else {
          reject(err);
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new PublicError(`ffmpeg timed out converting ${path.basename(inputPath)} and was stopped.`));
        } else if (code === 0) {
          resolve();
        } else {
          console.error(stderr.slice(-2000));
          reject(new PublicError(`ffmpeg could not convert ${path.basename(inputPath)} (exit code ${code}).`));
        }
      });
    });
  }
}
