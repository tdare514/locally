import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenCipher } from "../../src/server/crypto/TokenCipher";

const key = crypto.randomBytes(32);

describe("TokenCipher", () => {
  it("round-trips and uses the v1:iv:body format with a fresh IV each time", () => {
    const cipher = new TokenCipher(key);
    const a = cipher.encrypt("refresh-token-secret", "spotify-link:u1");
    const b = cipher.encrypt("refresh-token-secret", "spotify-link:u1");
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(a).not.toContain("refresh-token-secret");
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split(":")[1]!, "base64")).toHaveLength(12);
    expect(cipher.decrypt(a, "spotify-link:u1")).toBe("refresh-token-secret");
  });

  it("fails on the wrong AAD", () => {
    const cipher = new TokenCipher(key);
    const enc = cipher.encrypt("x", "spotify-link:u1");
    expect(() => cipher.decrypt(enc, "spotify-link:u2")).toThrow();
  });

  it("fails on a flipped byte", () => {
    const cipher = new TokenCipher(key);
    const [p, iv, body] = cipher.encrypt("some token", "aad").split(":");
    const bytes = Buffer.from(body!, "base64");
    bytes[0] = bytes[0]! ^ 1;
    expect(() => cipher.decrypt(`${p}:${iv}:${bytes.toString("base64")}`, "aad")).toThrow();
  });

  it("fails on the wrong key and an unknown prefix, without leaking plaintext", () => {
    const enc = new TokenCipher(key).encrypt("topsecret", "aad");
    expect(() => new TokenCipher(crypto.randomBytes(32)).decrypt(enc, "aad")).toThrow();
    expect(() => new TokenCipher(key).decrypt(enc.replace(/^v1/, "v2"), "aad")).toThrow();
    try {
      new TokenCipher(key).decrypt(enc.replace(/^v1/, "v2"), "aad");
    } catch (e) {
      expect(String(e)).not.toContain("topsecret");
    }
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => new TokenCipher(Buffer.alloc(16))).toThrow();
  });
});
