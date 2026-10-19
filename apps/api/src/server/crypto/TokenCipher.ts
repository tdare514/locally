import crypto from "node:crypto";

const PREFIX = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for secrets at rest (Spotify tokens, #305). Output is `v1:<b64 iv>:<b64 ciphertext+tag>`.
 * The caller passes associated data (the Spotify service uses `spotify-link:<userId>`), so a
 * ciphertext copied into another row fails to decrypt. The `v1` prefix leaves room to rotate the key.
 * Errors never carry plaintext, key material or the ciphertext.
 */
export class TokenCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("TokenCipher key must be 32 bytes");
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return `${PREFIX}:${iv.toString("base64")}:${body.toString("base64")}`;
  }

  /** Throws a generic error on a wrong key, wrong AAD, tampering or an unknown prefix. */
  decrypt(encoded: string, aad: string): string {
    const parts = encoded.split(":");
    if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error("Cannot decrypt token");
    try {
      const iv = Buffer.from(parts[1]!, "base64");
      const body = Buffer.from(parts[2]!, "base64");
      if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new Error("bad shape");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Cannot decrypt token");
    }
  }
}
