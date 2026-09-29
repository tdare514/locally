import crypto from "node:crypto";

export class UpdateError extends Error {}

export type UpdateBuild = { url: string; sha256: string; size: number };
export type UpdateManifest = { version: string; notes: string; builds: Record<string, UpdateBuild> };

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const MAX_SIZE = 2 * 1024 ** 3;

function parseVersion(v: string): number[] {
  if (typeof v !== "string" || !VERSION_RE.test(v)) throw new UpdateError(`Invalid version: ${String(v)}`);
  return v.split(".").map(Number);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new UpdateError(`${what} is not valid JSON`);
  }
}

function validateBuild(value: unknown, allowedHost: string): UpdateBuild {
  if (!isPlainObject(value)) throw new UpdateError("Build entry is not an object");
  const { url, sha256, size } = value;
  if (typeof url !== "string") throw new UpdateError("Build url missing");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpdateError("Build url is not a URL");
  }
  if (parsed.protocol !== "https:") throw new UpdateError("Build url must be https");
  if (parsed.hostname !== allowedHost) throw new UpdateError("Build url host is not allowed");
  if (parsed.username || parsed.password) throw new UpdateError("Build url must not carry credentials");
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw new UpdateError("Build sha256 invalid");
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_SIZE) {
    throw new UpdateError("Build size invalid");
  }
  return { url, sha256, size };
}

export function parseUpdateEnvelope(
  raw: string,
  opts: { publicKeyPem: string; allowedHost: string },
): UpdateManifest {
  const envelope = parseJson(raw, "Update envelope");
  if (!isPlainObject(envelope) || typeof envelope.manifest !== "string" || typeof envelope.signature !== "string") {
    throw new UpdateError("Update envelope has the wrong shape");
  }
  const manifestStr = envelope.manifest;
  const sig = Buffer.from(envelope.signature, "base64");
  if (sig.length !== 64) throw new UpdateError("Update signature has the wrong length");
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(manifestStr, "utf8"), crypto.createPublicKey(opts.publicKeyPem), sig);
  } catch {
    throw new UpdateError("Update signature could not be checked");
  }
  if (!ok) throw new UpdateError("Update signature does not match");

  const manifest = parseJson(manifestStr, "Update manifest");
  if (!isPlainObject(manifest)) throw new UpdateError("Update manifest is not an object");
  const { version, notes, builds } = manifest;
  if (typeof version !== "string") throw new UpdateError("Manifest version missing");
  parseVersion(version);
  if (typeof notes !== "string" || notes.length > 5000) throw new UpdateError("Manifest notes invalid");
  if (!isPlainObject(builds)) throw new UpdateError("Manifest builds missing");
  const keys = Object.keys(builds);
  if (keys.length === 0) throw new UpdateError("Manifest has no builds");
  const out: Record<string, UpdateBuild> = {};
  for (const key of keys) {
    if (!/^(arm64|x64)$/.test(key)) throw new UpdateError(`Unknown build architecture: ${key}`);
    out[key] = validateBuild(builds[key], opts.allowedHost);
  }
  return { version, notes, builds: out };
}
