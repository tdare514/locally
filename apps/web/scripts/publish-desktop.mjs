// Owner-run: zips the packaged Locally.app, uploads it, then signs and uploads the update manifest (#71).
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export function compareVersions(a, b) {
  for (const v of [a, b]) {
    if (typeof v !== "string" || !VERSION_RE.test(v)) throw new Error(`Invalid version: ${String(v)}`);
  }
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function assertPublishable(next, current) {
  if (current !== null && compareVersions(next, current) <= 0) {
    throw new Error(`Version ${next} is not greater than the published ${current}. Bump version in package.json.`);
  }
}

export function buildEnvelope(manifestObj, privateKeyPem) {
  const manifest = JSON.stringify(manifestObj);
  const signature = crypto
    .sign(null, Buffer.from(manifest, "utf8"), crypto.createPrivateKey(privateKeyPem))
    .toString("base64");
  return { manifest, signature };
}

export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

function plistValue(plist, key) {
  const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return m ? m[1] : null;
}

async function main() {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configDir = path.join(os.homedir(), ".config", "locally");

  let token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    const envFile = path.join(configDir, "releases.env");
    if (!fs.existsSync(envFile)) throw new Error(`Missing ${envFile} with BLOB_READ_WRITE_TOKEN.`);
    token = parseEnvFile(fs.readFileSync(envFile, "utf8")).BLOB_READ_WRITE_TOKEN;
  }
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  const keyFile = path.join(configDir, "update-ed25519.pem");
  if (!fs.existsSync(keyFile)) throw new Error(`Missing ${keyFile}. Run npm run desktop:keygen first.`);
  const privateKeyPem = fs.readFileSync(keyFile, "utf8");

  const version = JSON.parse(fs.readFileSync(path.join(webDir, "package.json"), "utf8")).version;
  const arch = process.arch;
  if (arch !== "arm64" && arch !== "x64") throw new Error(`Unsupported architecture ${arch}.`);
  const appPath = path.join(webDir, "dist-desktop", arch === "arm64" ? "mac-arm64" : "mac", "Locally.app");
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const builtVersion = fs.existsSync(plistPath) ? plistValue(fs.readFileSync(plistPath, "utf8"), "CFBundleShortVersionString") : null;
  if (builtVersion !== version) {
    throw new Error(`Packaged app is ${builtVersion ?? "missing"}, package.json is ${version}: run npm run desktop:package first.`);
  }

  const { BlobNotFoundError, head, put } = await import("@vercel/blob");
  let current = null;
  try {
    const existing = await head("desktop/latest.json", { token });
    const res = await fetch(existing.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not read the current manifest (${res.status}).`);
    current = JSON.parse(JSON.parse(await res.text()).manifest).version;
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
  assertPublishable(version, current);

  const notesIdx = process.argv.indexOf("--notes");
  const notes = notesIdx >= 0 ? (process.argv[notesIdx + 1] ?? "") : "";

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "locally-publish-"));
  try {
    const zipPath = path.join(tmp, `Locally-${version}-${arch}.zip`);
    await execFileAsync("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);
    const bytes = fs.readFileSync(zipPath);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    const zip = await put(`desktop/Locally-${version}-${arch}.zip`, bytes, {
      access: "public",
      token,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/zip",
      multipart: true,
    });
    const manifest = { version, notes, builds: { [arch]: { url: zip.url, sha256, size: bytes.length } } };
    const envelope = buildEnvelope(manifest, privateKeyPem);
    const latest = await put("desktop/latest.json", JSON.stringify(envelope), {
      access: "public",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    console.log(`Zip:      ${zip.url}`);
    console.log(`Manifest: ${latest.url}`);
    console.log("The manifest URL must equal UPDATE_MANIFEST_URL in electron/lib/updateConfig.ts.");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
