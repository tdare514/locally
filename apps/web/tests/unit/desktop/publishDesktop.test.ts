import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertPublishable, buildEnvelope, parseEnvFile } from "../../../scripts/publish-desktop.mjs";

describe("publish-desktop", () => {
  it("refuses equal and lower versions, allows null and greater", () => {
    expect(() => assertPublishable("0.1.0", "0.1.0")).toThrow();
    expect(() => assertPublishable("0.1.0", "0.2.0")).toThrow();
    expect(() => assertPublishable("0.1.0", null)).not.toThrow();
    expect(() => assertPublishable("0.2.0", "0.1.0")).not.toThrow();
  });

  it("signs an envelope that verifies with the public key", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const env = buildEnvelope({ version: "0.2.0" }, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    expect(
      crypto.verify(null, Buffer.from(env.manifest, "utf8"), publicKey, Buffer.from(env.signature, "base64")),
    ).toBe(true);
  });

  it("parses env files", () => {
    expect(parseEnvFile('# c\n\nA=1\nB="two"\nC=\'three\'\n')).toEqual({ A: "1", B: "two", C: "three" });
  });
});
