// Owner-run, once: creates the Ed25519 key that signs desktop update manifests (#71).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".config", "locally");
const keyFile = path.join(dir, "update-ed25519.pem");

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
if (fs.existsSync(keyFile)) {
  console.error(`${keyFile} already exists; refusing to overwrite it.`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });

console.log(`Private key written to ${keyFile} (owner-only). Back it up; never commit it.\n`);
console.log(publicKey.export({ type: "spki", format: "pem" }));
console.log("Paste this into UPDATE_PUBLIC_KEY_PEM in apps/web/electron/lib/updateConfig.ts and commit it.");
