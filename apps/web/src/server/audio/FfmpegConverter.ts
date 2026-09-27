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
export class FfmpegConverter implements AudioConverter {
  constructor(private readonly binary: string = "ffmpeg") {}

  async toMp3(inputPath: string, outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    if (path.extname(inputPath).toLowerCase() === ".mp3") {
      await fs.copyFile(inputPath, outputPath);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.binary, [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "320k",
        outputPath,
      ]);

      let stderr = "";
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
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
        if (code === 0) {
          resolve();
        } else {
          console.error(stderr.slice(-2000));
          reject(new PublicError(`ffmpeg could not convert ${path.basename(inputPath)} (exit code ${code}).`));
        }
      });
    });
  }
}
