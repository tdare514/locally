import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PublicError } from "./errors";

/**
 * Convert (or copy, if already mp3) an audio file to a 320kbps mp3 at
 * `outputPath`. Uses the system `ffmpeg` binary on PATH.
 */
export async function toMp3(inputPath: string, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (path.extname(inputPath).toLowerCase() === ".mp3") {
    await fs.copyFile(inputPath, outputPath);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
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
            "ffmpeg was not found on PATH. Install ffmpeg (e.g. `brew install ffmpeg`) and try again."
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
