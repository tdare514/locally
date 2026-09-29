// Preflight for `desktop:package`: the app bundles a locally built LGPL ffmpeg (ADR 0006).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// process.arch -> the `uname -m` directory name scripts/build-ffmpeg.sh writes to.
export function vendorArchDir(arch) {
  return arch === "x64" ? "x86_64" : arch;
}

export function ffmpegVendorPath(root, arch) {
  return path.join(root, "electron", "vendor", "ffmpeg", vendorArchDir(arch), "ffmpeg");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = ffmpegVendorPath(process.cwd(), process.arch);
  if (!fs.existsSync(target)) {
    console.error(`check-ffmpeg: ${path.relative(process.cwd(), target)} is missing; run \`npm run desktop:ffmpeg\` first.`);
    process.exit(1);
  }
}
