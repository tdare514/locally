import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewer,
  parseUpdateEnvelope,
  UpdateError,
} from "../../../electron/lib/update-manifest";

const HOST = "store.public.blob.vercel-storage.com";
const keys = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

function goodManifest(over: Record<string, unknown> = {}, buildOver: Record<string, unknown> = {}) {
  return {
    version: "0.2.0",
    notes: "Fixes",
    builds: {
      arm64: { url: `https://${HOST}/desktop/Locally-0.2.0-arm64.zip`, sha256: "a".repeat(64), size: 1234, ...buildOver },
    },
    ...over,
  };
}

function sign(manifestStr: string, key = keys.privateKey): string {
  return crypto.sign(null, Buffer.from(manifestStr, "utf8"), key).toString("base64");
}

function envelope(manifest: unknown, key = keys.privateKey): string {
  const manifestStr = JSON.stringify(manifest);
  return JSON.stringify({ manifest: manifestStr, signature: sign(manifestStr, key) });
}

const opts = { publicKeyPem, allowedHost: HOST };

describe("parseUpdateEnvelope", () => {
  it("accepts a valid signed envelope", () => {
    const m = parseUpdateEnvelope(envelope(goodManifest()), opts);
    expect(m.version).toBe("0.2.0");
    expect(m.builds.arm64.size).toBe(1234);
  });

  it("rejects a tampered manifest", () => {
    const env = JSON.parse(envelope(goodManifest()));
    env.manifest = env.manifest.replace("0.2.0", "9.9.9");
    expect(() => parseUpdateEnvelope(JSON.stringify(env), opts)).toThrow(UpdateError);
  });

  it("rejects a signature from another key", () => {
    const other = crypto.generateKeyPairSync("ed25519");
    expect(() => parseUpdateEnvelope(envelope(goodManifest(), other.privateKey), opts)).toThrow(UpdateError);
  });

  it("rejects bad shapes", () => {
    const bad = [
      goodManifest({ version: undefined }),
      goodManifest({}, { sha256: "xyz" }),
      goodManifest({}, { size: 0 }),
      goodManifest({ builds: { ppc: { url: `https://${HOST}/x.zip`, sha256: "a".repeat(64), size: 1 } } }),
    ];
    for (const m of bad) expect(() => parseUpdateEnvelope(envelope(m), opts)).toThrow(UpdateError);
    expect(() => parseUpdateEnvelope("not json", opts)).toThrow(UpdateError);
  });

  it("rejects http and foreign-host URLs", () => {
    expect(() =>
      parseUpdateEnvelope(envelope(goodManifest({}, { url: `http://${HOST}/x.zip` })), opts),
    ).toThrow(UpdateError);
    expect(() =>
      parseUpdateEnvelope(envelope(goodManifest({}, { url: "https://evil.example.com/x.zip" })), opts),
    ).toThrow(UpdateError);
  });
});

describe("compareVersions", () => {
  it("orders numerically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
  });

  it("isNewer is false for equal and downgrade", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });

  it("throws on malformed versions", () => {
    expect(() => compareVersions("1.2", "1.2.3")).toThrow(UpdateError);
    expect(() => compareVersions("1.2.3-beta", "1.2.3")).toThrow(UpdateError);
  });
});
